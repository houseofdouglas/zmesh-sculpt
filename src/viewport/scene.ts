import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from 'three';
import { framingDistance } from './math/spherical-camera';

/** Neutral, warm-grey matte clay tone — the default material, no preset selection (FR-31 is out of scope). */
const CLAY_COLOR = 0xc9c2b8;
const CLAY_ROUGHNESS = 0.9;

const DEFAULT_FOV_DEG = 50;
const NEAR_MM = 0.1;
const FAR_MM = 5000;

/** Diameter of the Task 03 placeholder solid, mm — replaced by the real mesh in Task 04. */
const PLACEHOLDER_DIAMETER_MM = 50;

export interface ViewportScene {
  scene: Scene;
  camera: PerspectiveCamera;
  clayMaterial: MeshStandardMaterial;
  /** Temporary lit solid so the scene is visibly correct before Task 04 wires up the real mesh. */
  placeholder: Mesh;
}

/**
 * Builds the scene graph (FR-8): a neutral matte clay material, three-point
 * lighting (key + fill + ambient) that reads form from any angle without
 * harsh unlit shadows, and a static perspective camera framing a
 * placeholder solid. Camera interactivity (orbit/pan/zoom) is Task 05;
 * this task only needs a sane static vantage point.
 */
export function createScene(aspect: number): ViewportScene {
  const scene = new Scene();

  const clayMaterial = new MeshStandardMaterial({
    color: CLAY_COLOR,
    roughness: CLAY_ROUGHNESS,
    metalness: 0,
  });

  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 8, 6);
  const fill = new DirectionalLight(0xffffff, 0.7);
  fill.position.set(-6, 2, -4);
  const ambient = new AmbientLight(0xffffff, 0.5);
  scene.add(key, fill, ambient);

  const camera = new PerspectiveCamera(DEFAULT_FOV_DEG, aspect, NEAR_MM, FAR_MM);
  const fovYRadians = (DEFAULT_FOV_DEG * Math.PI) / 180;
  // A sphere's own AABB diagonal (diameter * sqrt(3)) as the bounding
  // measure passed to framingDistance — the same math Task 05's
  // frameModel will reuse for the real mesh's actual bounds.
  const boundsDiagonalMm = PLACEHOLDER_DIAMETER_MM * Math.sqrt(3);
  camera.position.set(0, 0, framingDistance(boundsDiagonalMm, fovYRadians));
  camera.lookAt(0, 0, 0);

  const placeholder = new Mesh(new SphereGeometry(PLACEHOLDER_DIAMETER_MM / 2, 32, 16), clayMaterial);
  scene.add(placeholder);

  return { scene, camera, clayMaterial, placeholder };
}
