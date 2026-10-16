import { CatmullRomCurve3, Vector3 } from "three";

export type TrackSection =
  | "coastal-boulevard"
  | "causeway"
  | "tunnel"
  | "cliff-dive"
  | "underwater"
  | "final-skyline";

/** A renderer-ready control point in world space. */
export type TrackPoint = {
  readonly position: Vector3;
  /** Road width in world units at this point. */
  readonly width: number;
  /** The environment used for the segment beginning at this point. */
  readonly section: TrackSection;
  readonly name?: string;
};

/** A deterministic straight segment between two route points. */
export type TrackSegment = {
  readonly index: number;
  readonly start: TrackPoint;
  readonly end: TrackPoint;
  readonly startDistance: number;
  readonly endDistance: number;
  readonly length: number;
  readonly section: TrackSection;
};

export type TrackRoute = {
  readonly points: readonly TrackPoint[];
  readonly segments: readonly TrackSegment[];
  readonly totalLength: number;
  readonly closed: boolean;
};

export type NearestTrackPoint = {
  /** Euclidean distance from the query point to the centerline. */
  readonly distanceFromTrack: number;
  /** Distance along the route to the nearest centerline point. */
  readonly distanceAlongTrack: number;
  readonly position: Vector3;
  readonly tangent: Vector3;
  readonly width: number;
  readonly segmentIndex: number;
  readonly section: TrackSection;
};

export type Vector3Like = Readonly<{ x: number; y: number; z: number }>;

const EPSILON = 1e-8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function copyTrackPoint(point: TrackPoint): TrackPoint {
  return {
    ...point,
    position: point.position.clone(),
    width: Math.max(0, point.width),
  };
}

/**
 * Build a route once from control points. The route is immutable by convention:
 * points and segments are cloned so later renderer edits cannot alter sampling.
 */
export function createTrackRoute(
  inputPoints: readonly TrackPoint[],
  closed = true,
): TrackRoute {
  if (inputPoints.length < 2) {
    throw new RangeError("A track route needs at least two points.");
  }

  const points = inputPoints.map(copyTrackPoint);
  const segments: TrackSegment[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  let distance = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const length = start.position.distanceTo(end.position);
    const segment: TrackSegment = {
      index,
      start,
      end,
      startDistance: distance,
      endDistance: distance + length,
      length,
      section: start.section,
    };
    segments.push(segment);
    distance += length;
  }

  return {
    points,
    segments,
    totalLength: distance,
    closed,
  };
}

/** Sample the authored curve once; rendering, collision and timing share it. */
export function createSmoothTrackRoute(
  controlPoints: readonly TrackPoint[],
  closed = true,
  spacing = 2,
): TrackRoute {
  if (controlPoints.length < 3) return createTrackRoute(controlPoints, closed);
  const curve = new CatmullRomCurve3(
    controlPoints.map((point) => point.position.clone()), closed, "centripetal",
  );
  const spanCount = closed ? controlPoints.length : controlPoints.length - 1;
  const points: TrackPoint[] = [];
  const stepSize = Number.isFinite(spacing) ? Math.max(0.5, spacing) : 2;
  for (let span = 0; span < spanCount; span += 1) {
    const start = controlPoints[span];
    const end = controlPoints[(span + 1) % controlPoints.length];
    const steps = Math.max(4, Math.ceil(start.position.distanceTo(end.position) / stepSize));
    for (let step = 0; step < steps; step += 1) {
      const amount = step / steps;
      points.push({
        position: curve.getPoint((span + amount) / spanCount),
        width: start.width + (end.width - start.width) * amount,
        section: start.section,
        ...(step === 0 ? { name: start.name } : {}),
      });
    }
  }
  if (!closed) points.push(copyTrackPoint(controlPoints[controlPoints.length - 1]));
  return createTrackRoute(points, closed);
}

export function sampleTrackSection(route: TrackRoute, distance: number): TrackSection {
  return findSegment(route, distance)?.section ?? "coastal-boulevard";
}

export function sampleTrackWidth(route: TrackRoute, distance: number): number {
  const segment = findSegment(route, distance);
  if (!segment) return 0;
  const amount = segment.length > EPSILON
    ? clamp((normalizeDistance(route, distance) - segment.startDistance) / segment.length, 0, 1)
    : 0;
  return segment.start.width + (segment.end.width - segment.start.width) * amount;
}

function normalizeDistance(route: TrackRoute, distance: number): number {
  if (route.totalLength <= EPSILON || !Number.isFinite(distance)) return 0;
  if (!route.closed) return clamp(distance, 0, route.totalLength);
  const wrapped = distance % route.totalLength;
  return wrapped < 0 ? wrapped + route.totalLength : wrapped;
}

function findSegment(route: TrackRoute, distance: number): TrackSegment | undefined {
  if (route.segments.length === 0) return undefined;
  const normalizedDistance = normalizeDistance(route, distance);

  // Ignore zero-length control-point spans when choosing a tangent.
  for (const segment of route.segments) {
    if (
      segment.length > EPSILON &&
      normalizedDistance <= segment.endDistance + EPSILON
    ) {
      return segment;
    }
  }

  for (let index = route.segments.length - 1; index >= 0; index -= 1) {
    if (route.segments[index].length > EPSILON) return route.segments[index];
  }
  return route.segments[0];
}

/** Sample the centerline position at a distance along the route. */
export function sampleTrackPosition(
  route: TrackRoute,
  distance: number,
  target = new Vector3(),
): Vector3 {
  const segment = findSegment(route, distance);
  if (!segment) return target.set(0, 0, 0);
  if (segment.length <= EPSILON) return target.copy(segment.start.position);

  const normalizedDistance = normalizeDistance(route, distance);
  const amount = clamp(
    (normalizedDistance - segment.startDistance) / segment.length,
    0,
    1,
  );
  return target.lerpVectors(segment.start.position, segment.end.position, amount);
}

/** Sample a normalized centerline tangent at a distance along the route. */
export function sampleTrackTangent(
  route: TrackRoute,
  distance: number,
  target = new Vector3(),
): Vector3 {
  const segment = findSegment(route, distance);
  if (!segment) return target.set(0, 0, 1);
  target.subVectors(segment.end.position, segment.start.position);
  if (target.lengthSq() <= EPSILON) return target.set(0, 0, 1);
  return target.normalize();
}

/** Return the closest centerline point and its route metadata. */
export function findNearestTrackPoint(
  route: TrackRoute,
  query: Vector3Like,
): NearestTrackPoint {
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  const bestPosition = new Vector3();
  const bestTangent = new Vector3(0, 0, 1);
  let bestDistanceAlong = 0;
  let bestWidth = 0;
  let bestSegmentIndex = 0;
  let bestSection: TrackSection = "coastal-boulevard";

  for (const segment of route.segments) {
    const start = segment.start.position;
    const end = segment.end.position;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const amount =
      lengthSquared <= EPSILON
        ? 0
        : clamp(
            ((query.x - start.x) * dx + (query.y - start.y) * dy + (query.z - start.z) * dz) / lengthSquared,
            0,
            1,
          );
    const x = start.x + dx * amount;
    const y = start.y + dy * amount;
    const z = start.z + dz * amount;
    const distanceSquared = (query.x - x) ** 2 + (query.y - y) ** 2 + (query.z - z) ** 2;

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestPosition.set(x, y, z);
      bestDistanceAlong = segment.startDistance + amount * segment.length;
      bestWidth = segment.start.width + (segment.end.width - segment.start.width) * amount;
      bestSegmentIndex = segment.index;
      bestSection = segment.section;
      if (lengthSquared > EPSILON) bestTangent.set(dx, dy, dz).normalize();
    }
  }

  if (!Number.isFinite(bestDistanceSquared)) {
    const fallback = route.points[0];
    bestPosition.copy(fallback.position);
    bestWidth = fallback.width;
    bestSection = fallback.section;
    bestDistanceSquared = (query.x - bestPosition.x) ** 2 + (query.y - bestPosition.y) ** 2 + (query.z - bestPosition.z) ** 2;
  }

  return {
    distanceFromTrack: Math.sqrt(bestDistanceSquared),
    distanceAlongTrack: bestDistanceAlong,
    position: bestPosition,
    tangent: bestTangent,
    width: bestWidth,
    segmentIndex: bestSegmentIndex,
    section: bestSection,
  };
}

/** Calculate the shortest Euclidean distance from a world point to the route. */
export function calculateNearestTrackDistance(
  route: TrackRoute,
  query: Vector3Like,
): number {
  return findNearestTrackPoint(route, query).distanceFromTrack;
}

/** Readable alias for callers that prefer a getter-style name. */
export function getNearestTrackDistance(
  route: TrackRoute,
  query: Vector3Like,
): number {
  return calculateNearestTrackDistance(route, query);
}

const trackPoint = (
  x: number,
  y: number,
  z: number,
  section: TrackSection,
  name: string,
  width = 12,
): TrackPoint => ({
  position: new Vector3(x, y, z),
  width,
  section,
  name,
});

/**
 * The first playable route: a coastal boulevard climbs onto a causeway,
 * threads a refined tunnel, dives into a long underwater return, and finishes
 * through a final skyline loop before rejoining the harbor start. The last
 * approach is tangent-aligned with the first span so the closed loop has no
 * visible snap at the start line.
 */
export const SAMPLE_TRACK_POINTS: readonly TrackPoint[] = [
  trackPoint(0, 0, 0, "coastal-boulevard", "harbor start"),
  trackPoint(55, 0, -8, "coastal-boulevard", "palm straight"),
  trackPoint(110, 1, -28, "coastal-boulevard", "cliff bend"),
  trackPoint(155, 3, -65, "coastal-boulevard", "boulevard overlook"),
  trackPoint(180, 4, -105, "coastal-boulevard", "causeway approach"),

  trackPoint(215, 5, -145, "causeway", "causeway entry", 13),
  trackPoint(255, 6, -155, "causeway", "open water span", 13),
  trackPoint(285, 7, -115, "causeway", "causeway bend", 13),
  trackPoint(300, 8, -55, "causeway", "lantern pylons", 13),
  trackPoint(295, 8, 10, "causeway", "tunnel approach", 13),
  trackPoint(275, 7, 65, "causeway", "tunnel mouth", 12),

  trackPoint(245, 6, 105, "tunnel", "tunnel entry", 11),
  trackPoint(190, 5, 128, "tunnel", "tunnel ribs east", 11),
  trackPoint(120, 4, 138, "tunnel", "tunnel gallery", 11),
  trackPoint(45, 3, 140, "tunnel", "tunnel gallery west", 11),
  trackPoint(-35, 12, 135, "tunnel", "tunnel lights", 11),
  trackPoint(-110, 24, 120, "tunnel", "tunnel curve", 11),
  trackPoint(-175, 30, 92, "tunnel", "tunnel exit ramp", 11),
  trackPoint(-215, 31, 55, "tunnel", "tunnel exit", 12),
  trackPoint(-230, 31, 15, "cliff-dive", "cliff lip", 12),

  trackPoint(-250, -14, -150, "underwater", "underwater landing", 18),
  trackPoint(-250, -17, -195, "underwater", "sunken straight", 14),
  trackPoint(-235, -17, -235, "underwater", "reef bend", 14),
  trackPoint(-185, -20, -265, "underwater", "kelp trench", 14),
  trackPoint(-115, -21, -285, "underwater", "deep glassway", 14),
  trackPoint(-35, -21, -290, "underwater", "deep glassway south", 14),
  trackPoint(50, -19, -270, "underwater", "reef lights", 14),
  trackPoint(125, -14, -240, "underwater", "ascent bend", 14),
  trackPoint(190, -8, -195, "underwater", "surfacing gate", 14),

  trackPoint(245, -1, -180, "final-skyline", "skyline surfacing", 13),
  trackPoint(345, 7, -145, "final-skyline", "skyline east", 13),
  trackPoint(365, 14, -95, "final-skyline", "skyline towers", 13),
  trackPoint(350, 22, -45, "final-skyline", "skyline bend", 13),
  // Cross the causeway once, with room for the road, car and chase camera.
  trackPoint(300, 24, 5, "final-skyline", "causeway flyover", 13),
  trackPoint(240, 22, 35, "final-skyline", "neon district", 13),
  trackPoint(180, 16, 40, "final-skyline", "neon district north", 13),
  trackPoint(90, 6, 55, "final-skyline", "skyline panorama", 13),
  trackPoint(0, 3, 60, "final-skyline", "skyline panorama west", 13),
  trackPoint(-90, 2, 50, "final-skyline", "skyline west", 13),
  trackPoint(-120, 1, 40, "final-skyline", "skyline return", 13),
  trackPoint(-145, 1, 25, "final-skyline", "harbor lights west", 13),
  trackPoint(-175, 0, 18, "final-skyline", "harbor lights bend", 13),
  trackPoint(-195, 0, 2, "final-skyline", "harbor lights west", 13),
  trackPoint(-198, 0, -16, "final-skyline", "harbor lights", 13),
  trackPoint(-175, 0, -28, "final-skyline", "harbor approach west", 13),
  trackPoint(-135, 0, -30, "final-skyline", "harbor approach", 13),
  trackPoint(-90, 0, -25, "final-skyline", "harbor approach east", 13),
  trackPoint(-45, 0, -15, "final-skyline", "harbor approach straight", 13),
  trackPoint(-20, 0, -5, "final-skyline", "start-line approach", 13),
];

export const SAMPLE_ROUTE: TrackRoute = createSmoothTrackRoute(SAMPLE_TRACK_POINTS, true);

/** Convenient aliases for renderers that call the route a track. */
export const SAMPLE_TRACK = SAMPLE_ROUTE;
export const sampleRoute = SAMPLE_ROUTE;
