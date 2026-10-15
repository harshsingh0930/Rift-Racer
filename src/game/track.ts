import { Vector3 } from "three";

export type TrackSection = "coastal-boulevard" | "tunnel" | "underwater";

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
  const queryPosition = new Vector3(query.x, query.y, query.z);
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestPosition = new Vector3();
  let bestTangent = new Vector3(0, 0, 1);
  let bestDistanceAlong = 0;
  let bestWidth = 0;
  let bestSegmentIndex = 0;
  let bestSection: TrackSection = "coastal-boulevard";

  for (const segment of route.segments) {
    const direction = new Vector3().subVectors(
      segment.end.position,
      segment.start.position,
    );
    const lengthSquared = direction.lengthSq();
    const amount =
      lengthSquared <= EPSILON
        ? 0
        : clamp(
            new Vector3()
              .subVectors(queryPosition, segment.start.position)
              .dot(direction) / lengthSquared,
            0,
            1,
          );
    const candidate = new Vector3().lerpVectors(
      segment.start.position,
      segment.end.position,
      amount,
    );
    const distanceSquared = queryPosition.distanceToSquared(candidate);

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestPosition = candidate;
      bestDistanceAlong = segment.startDistance + amount * segment.length;
      bestWidth = segment.start.width + (segment.end.width - segment.start.width) * amount;
      bestSegmentIndex = segment.index;
      bestSection = segment.section;
      if (lengthSquared > EPSILON) bestTangent.copy(direction).normalize();
    }
  }

  if (!Number.isFinite(bestDistanceSquared)) {
    const fallback = route.points[0];
    bestPosition = fallback.position.clone();
    bestWidth = fallback.width;
    bestSection = fallback.section;
    bestDistanceSquared = queryPosition.distanceToSquared(bestPosition);
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
 * The first playable route slice: a sunny coastal boulevard dives through a
 * short tunnel, then drops below the water before returning to the coast.
 * Coordinates are deterministic and intentionally modest for easy scene setup.
 */
export const SAMPLE_TRACK_POINTS: readonly TrackPoint[] = [
  trackPoint(0, 0, 0, "coastal-boulevard", "harbor start"),
  trackPoint(34, 0, 0, "coastal-boulevard", "palm straight"),
  trackPoint(64, 2, -18, "coastal-boulevard", "cliff bend"),
  trackPoint(70, 3, -52, "coastal-boulevard", "tunnel mouth"),
  trackPoint(58, 5, -78, "tunnel", "tunnel entry", 11),
  trackPoint(24, 4, -92, "tunnel", "tunnel curve", 11),
  trackPoint(-8, 3, -90, "tunnel", "tunnel exit", 11),
  trackPoint(-34, 1, -70, "tunnel", "shoreline ramp", 11),
  trackPoint(-48, -4, -40, "underwater", "descent", 14),
  trackPoint(-52, -10, -4, "underwater", "sunken straight", 14),
  trackPoint(-34, -12, 25, "underwater", "reef bend", 14),
  trackPoint(0, -9, 42, "underwater", "kelp tunnel", 14),
  trackPoint(34, -4, 34, "underwater", "ascent", 14),
  trackPoint(48, 0, 16, "coastal-boulevard", "surfacing bend"),
];

export const SAMPLE_ROUTE: TrackRoute = createTrackRoute(SAMPLE_TRACK_POINTS, true);

/** Convenient aliases for renderers that call the route a track. */
export const SAMPLE_TRACK = SAMPLE_ROUTE;
export const sampleRoute = SAMPLE_ROUTE;
