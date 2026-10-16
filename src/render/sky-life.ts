import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, type TrackRoute, type Vector3Like } from "../game/track";
import type { QualityTier } from "../game/performance";

/** Simple distant silhouettes, never detailed animals or expensive particle systems. */
export class SkyLife extends Group {
  private readonly floating: Array<{ group: Group; height: number; phase: number }> = [];
  private readonly comets = new Group();
  private readonly time = { value: 0 };
  constructor(route: TrackRoute, quality: QualityTier) {
    super();this.name = "rift-living-sky";
    const spacing = quality === "eco" ? 180 : quality === "balanced" ? 125 : 95;
    const balloonGeometry = new SphereGeometry(1, 12, 9);
    const colors = new Float32Array(balloonGeometry.getAttribute("position").count * 3);
    const position = balloonGeometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const stripe = Math.floor((Math.atan2(position.getZ(i), position.getX(i)) + Math.PI) / Math.PI * 6);
      new Color(stripe % 2 ? 0xe76583 : 0xb67bca).toArray(colors, i * 3);
    }
    balloonGeometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const balloonMaterial = new MeshBasicMaterial({ vertexColors: true, fog: false });
    const dark = new MeshBasicMaterial({ color: 0x241a2c, fog: false });
    const kiteGeometry = new BufferGeometry();kiteGeometry.setAttribute("position", new Float32BufferAttribute([0, 1.6, 0, -1, 0, 0, 0, -1.1, 0, 1, 0, 0], 3));kiteGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    const kiteMaterial = new MeshBasicMaterial({ color: 0xf58cc7, side: 2, fog: false });
    const birdLocations: Vector3[] = [];
    for (let distance = 25, index = 0; distance < route.totalLength; distance += spacing, index++) {
      const section = sampleTrackSection(route, distance);
      if (section === "tunnel" || section === "underwater" || section === "cliff-dive") continue;
      const center = sampleTrackPosition(route, distance);const tangent = sampleTrackTangent(route, distance);
      const side = new Vector3().crossVectors(new Vector3(0, 1, 0), tangent).normalize();
      const anchor = center.clone().addScaledVector(side, (index % 2 ? -1 : 1) * (32 + index % 3 * 10));
      const balloon = new Group();balloon.name = "rift-hot-air-balloon";
      balloon.position.copy(anchor);balloon.position.y += 24 + index % 4 * 5;
      const envelope = new Mesh(balloonGeometry, balloonMaterial);envelope.scale.set(2.3, 3.3, 2.3);balloon.add(envelope);
      const basket = new Mesh(new BoxGeometry(0.8, 0.55, 0.8), dark);basket.position.y = -4.1;balloon.add(basket);
      const ropes = new BufferGeometry();ropes.setAttribute("position", new Float32BufferAttribute([
        -0.3, -3.1, -0.3, -0.3, -4, -0.3, 0.3, -3.1, 0.3, 0.3, -4, 0.3], 3));
      balloon.add(new LineSegments(ropes, new LineBasicMaterial({ color: 0x392344, fog: false })));
      this.add(balloon);this.floating.push({ group: balloon, height: balloon.position.y, phase: index * 1.7 });
      if (index % 2 === 0) {
        const kite = new Group();kite.name = "rift-sky-kite";kite.position.copy(anchor).addScaledVector(tangent, 35);kite.position.y += 20;
        const body = new Mesh(kiteGeometry, kiteMaterial);body.rotation.y = Math.atan2(tangent.x, tangent.z);kite.add(body);
        const tail = new BufferGeometry();tail.setAttribute("position", new Float32BufferAttribute([0, -1.1, 0, 0.3, -3.5, 0, 0.3, -3.5, 0, -0.4, -5, 0], 3));
        kite.add(new LineSegments(tail, new LineBasicMaterial({ color: 0xbba6cd, fog: false })));
        this.add(kite);this.floating.push({ group: kite, height: kite.position.y, phase: index });
        const party = new Group();party.name = "rift-helium-balloons";party.position.copy(anchor).addScaledVector(tangent, -18);party.position.y += 13;
        for (let i = 0; i < 3; i++) {
          const small = new Mesh(new SphereGeometry(0.65, 7, 6), new MeshBasicMaterial({ color: [0xef8db7, 0x8fd9e0, 0xe7b06d][i], fog: false }));
          small.position.set(i * 0.9, i % 2, 0);small.scale.y = 1.3;party.add(small);
        }
        const strings = new BufferGeometry();strings.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0.9, -4, 0, 0.9, 1, 0, 0.9, -4, 0, 1.8, 0, 0, 0.9, -4, 0], 3));
        party.add(new LineSegments(strings, new LineBasicMaterial({ color: 0x8d789d, fog: false })));this.add(party);
      }
      for (let bird = 0; bird < 5; bird++) birdLocations.push(anchor.clone().add(new Vector3((bird - 2) * 3, 17 + bird % 2 * 2, bird * 3)));
    }
    const birdGeometry = new BufferGeometry();birdGeometry.setAttribute("position", new Float32BufferAttribute([
      0, 0, 0, -0.5, 0.05, 0.12, -1.5, 0.2, -0.35,
      0, 0, 0, 0.5, 0.05, 0.12, 1.5, 0.2, -0.35,
    ], 3));
    const matrix = new Matrix4();
    for (const white of [false, true]) {
      const material = new MeshBasicMaterial({ color: white ? 0xece8ed : 0x12101b, side: 2, fog: false });
      material.onBeforeCompile = shader => {
        shader.uniforms.skyTime = this.time;
        shader.vertexShader = 'uniform float skyTime;\n' + shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y += abs(position.x)*sin(skyTime*5.5+instanceMatrix[3].x)*0.28;');
      };
      const birds = new InstancedMesh(birdGeometry, material, Math.ceil(birdLocations.length / 2));birds.name = white ? "rift-white-birds" : "rift-black-birds";
      let count = 0;birdLocations.forEach((point, i) => { if ((i % 2 === 0) !== white) return;matrix.makeRotationY(i * 0.75);matrix.setPosition(point);birds.setMatrixAt(count++, matrix); });
      birds.count = count;birds.computeBoundingSphere();this.add(birds);
    }
    this.comets.name = "rift-sky-comets";this.comets.userData.dynamicVisibility = true;
    for (let i = 0; i < 3; i++) {
      const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 15, 4, 4], 3));
      geometry.setAttribute("color", new Float32BufferAttribute([0.9, 0.95, 1, 0.08, 0.04, 0.15], 3));
      const streak = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, fog: false }));
      this.comets.add(streak);
    }
    this.add(this.comets);
  }
  update(time: number, focus?: Vector3Like): void {
    this.time.value = time;
    this.floating.forEach(({ group, height, phase }) => { group.position.y = height + Math.sin(time * 0.45 + phase) * 0.7;group.rotation.z = Math.sin(time * 0.3 + phase) * 0.045; });
    if (!focus) return;
    this.comets.position.set(focus.x, focus.y, focus.z);
    this.comets.children.forEach((object, index) => {
      const t = (time * 0.045 + index * 0.31) % 1;
      object.position.set(90 - t * 210, 40 + index * 13 - t * 10, (index - 1) * 105);
      (object as LineSegments<BufferGeometry, LineBasicMaterial>).material.opacity = Math.sin(t * Math.PI) ** 2 * 0.85;
    });
  }
}
