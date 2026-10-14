/**
 * MediaPipe Pose Landmarker index map and the small subset of it this app cares
 * about. Keeping the indices in one place stops magic numbers leaking into the
 * geometry code.
 */

export const POSE = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** Landmarks that must be visible before we trust a rep. */
export const REQUIRED_LANDMARKS: readonly number[] = [
  POSE.leftShoulder,
  POSE.rightShoulder,
  POSE.leftHip,
  POSE.rightHip,
  POSE.leftKnee,
  POSE.rightKnee,
  POSE.leftAnkle,
  POSE.rightAnkle,
];

/** Pairs to draw as a skeleton overlay. */
export const POSE_CONNECTIONS: readonly [number, number][] = [
  [POSE.leftShoulder, POSE.rightShoulder],
  [POSE.leftShoulder, POSE.leftHip],
  [POSE.rightShoulder, POSE.rightHip],
  [POSE.leftHip, POSE.rightHip],
  [POSE.leftHip, POSE.leftKnee],
  [POSE.rightHip, POSE.rightKnee],
  [POSE.leftKnee, POSE.leftAnkle],
  [POSE.rightKnee, POSE.rightAnkle],
  [POSE.leftAnkle, POSE.leftFootIndex],
  [POSE.rightAnkle, POSE.rightFootIndex],
];

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  /** MediaPipe confidence in [0,1]. Absent on some builds; treated as 1. */
  visibility?: number;
}

export function visibilityOf(landmark: Landmark | undefined): number {
  if (!landmark) return 0;
  return landmark.visibility ?? 1;
}
