import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

export type VrmGestureName = 'wave' | 'nod' | 'shake' | 'raiseLeftArm';
export type VrmLocomotionMode = 'idle' | 'inPlace' | 'forward';

export interface VrmAiCommand {
  type: 'gesture' | 'locomotion' | 'stop';
  gesture?: VrmGestureName;
  durationSec?: number;
  speed?: number;
  turnRate?: number;
  mode?: VrmLocomotionMode;
}

export interface VrmMotionSnapshot {
  activeGesture: VrmGestureName | null;
  locomotionMode: VrmLocomotionMode;
  locomotionSpeed: number;
  turnRate: number;
}

interface GestureRuntime {
  name: VrmGestureName;
  elapsedSec: number;
  durationSec: number;
}

interface BoneCacheItem {
  bone: THREE.Object3D;
  baseRotation: THREE.Euler;
}

const CLAMP_SPEED_MAX = 1.6;
const DEFAULT_GESTURE_DURATION: Record<VrmGestureName, number> = {
  wave: 2.2,
  nod: 1.2,
  shake: 1.2,
  raiseLeftArm: 2.0,
};

const TRACKED_BONES: VRMHumanBoneName[] = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class VrmActionController {
  private readonly bones = new Map<VRMHumanBoneName, BoneCacheItem>();
  private readonly rootPosition = new THREE.Vector3();
  private vrm: VRM | null = null;
  private activeGesture: GestureRuntime | null = null;
  private locomotionMode: VrmLocomotionMode = 'idle';
  private locomotionSpeed = 0;
  private turnRate = 0;
  private gaitTimeSec = 0;
  private idleTimeSec = 0;

  bind(vrm: VRM): void {
    this.vrm = vrm;
    this.captureBasePose(vrm);
    this.rootPosition.copy(vrm.scene.position);
    this.reset();
  }

  unbind(): void {
    this.vrm = null;
    this.bones.clear();
    this.activeGesture = null;
    this.locomotionMode = 'idle';
    this.locomotionSpeed = 0;
    this.turnRate = 0;
    this.gaitTimeSec = 0;
    this.idleTimeSec = 0;
  }

  captureBasePose(vrm: VRM): void {
    this.bones.clear();
    for (const boneName of TRACKED_BONES) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (!bone) {
        continue;
      }
      this.bones.set(boneName, {
        bone,
        baseRotation: bone.rotation.clone(),
      });
    }
  }

  reset(): void {
    this.activeGesture = null;
    this.locomotionMode = 'idle';
    this.locomotionSpeed = 0;
    this.turnRate = 0;
    this.gaitTimeSec = 0;
    this.idleTimeSec = 0;
    this.applyBasePose();
  }

  triggerGesture(name: VrmGestureName, durationSec?: number): void {
    const normalizedDuration = clamp(durationSec ?? DEFAULT_GESTURE_DURATION[name], 0.2, 8);
    this.activeGesture = {
      name,
      elapsedSec: 0,
      durationSec: normalizedDuration,
    };
  }

  setLocomotion(mode: VrmLocomotionMode, speed: number, turnRate = 0): void {
    this.locomotionMode = mode;
    this.locomotionSpeed = clamp(speed, 0, CLAMP_SPEED_MAX);
    this.turnRate = clamp(turnRate, -2.5, 2.5);
  }

  stopLocomotion(): void {
    this.locomotionMode = 'idle';
    this.locomotionSpeed = 0;
    this.turnRate = 0;
  }

  dispatch(command: VrmAiCommand): void {
    if (command.type === 'gesture' && command.gesture) {
      this.triggerGesture(command.gesture, command.durationSec);
      return;
    }

    if (command.type === 'locomotion') {
      this.setLocomotion(command.mode ?? 'inPlace', command.speed ?? 0.8, command.turnRate ?? 0);
      return;
    }

    this.stopLocomotion();
  }

  getSnapshot(): VrmMotionSnapshot {
    return {
      activeGesture: this.activeGesture?.name ?? null,
      locomotionMode: this.locomotionMode,
      locomotionSpeed: this.locomotionSpeed,
      turnRate: this.turnRate,
    };
  }

  update(deltaSec: number): void {
    if (!this.vrm) {
      return;
    }

    this.applyBasePose();

    this.idleTimeSec += deltaSec;
    this.applyIdleLayer(this.idleTimeSec);

    if (this.locomotionMode !== 'idle' && this.locomotionSpeed > 0.01) {
      this.gaitTimeSec += deltaSec;
      this.applyLocomotionLayer(deltaSec, this.gaitTimeSec);
    }

    if (this.activeGesture) {
      this.activeGesture.elapsedSec += deltaSec;
      const progress = clamp(this.activeGesture.elapsedSec / this.activeGesture.durationSec, 0, 1);
      this.applyGestureLayer(this.activeGesture.name, progress, this.activeGesture.elapsedSec);
      if (this.activeGesture.elapsedSec >= this.activeGesture.durationSec) {
        this.activeGesture = null;
      }
    }
  }

  private applyBasePose(): void {
    for (const item of this.bones.values()) {
      item.bone.rotation.copy(item.baseRotation);
    }
  }

  private applyIdleLayer(timeSec: number): void {
    const breathing = Math.sin(timeSec * Math.PI * 0.8) * 0.02;
    const microHead = Math.sin(timeSec * Math.PI * 0.35) * 0.02;

    this.addRotation('chest', breathing, 0, 0);
    this.addRotation('upperChest', breathing * 0.6, 0, 0);
    this.addRotation('neck', microHead * 0.3, 0, 0);
    this.addRotation('head', microHead * 0.5, 0, 0);
  }

  private applyLocomotionLayer(deltaSec: number, gaitTimeSec: number): void {
    const speedNorm = clamp(this.locomotionSpeed / CLAMP_SPEED_MAX, 0, 1);
    const freqHz = 1.55 + speedNorm * 0.9;
    const phase = gaitTimeSec * Math.PI * 2 * freqHz;
    const stride = 0.18 + speedNorm * 0.28;
    const armSwing = stride * 0.58;

    const leftLeg = Math.sin(phase);
    const rightLeg = Math.sin(phase + Math.PI);

    this.addRotation('leftUpperLeg', leftLeg * stride, 0, 0);
    this.addRotation('rightUpperLeg', rightLeg * stride, 0, 0);

    this.addRotation('leftLowerLeg', Math.max(0, -leftLeg) * (stride * 1.1), 0, 0);
    this.addRotation('rightLowerLeg', Math.max(0, -rightLeg) * (stride * 1.1), 0, 0);

    this.addRotation('leftUpperArm', -leftLeg * armSwing, 0, 0);
    this.addRotation('rightUpperArm', -rightLeg * armSwing, 0, 0);

    this.addRotation('leftLowerArm', Math.max(0, leftLeg) * 0.18, 0, 0);
    this.addRotation('rightLowerArm', Math.max(0, rightLeg) * 0.18, 0, 0);

    this.addRotation('hips', 0, Math.sin(phase) * 0.03, 0);
    this.addRotation('spine', 0, -Math.sin(phase) * 0.02, 0);

    if (!this.vrm) {
      return;
    }

    if (this.locomotionMode === 'forward') {
      const forwardDistance = this.locomotionSpeed * deltaSec;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.vrm.scene.quaternion);
      this.rootPosition.addScaledVector(forward, forwardDistance);
      this.vrm.scene.position.copy(this.rootPosition);
    }

    if (Math.abs(this.turnRate) > 0.001) {
      this.vrm.scene.rotation.y += this.turnRate * deltaSec;
    }
  }

  private applyGestureLayer(name: VrmGestureName, progress: number, elapsedSec: number): void {
    const fadeIn = clamp(progress / 0.2, 0, 1);
    const fadeOut = clamp((1 - progress) / 0.2, 0, 1);
    const weight = Math.min(fadeIn, fadeOut);

    if (name === 'wave') {
      const wave = Math.sin(elapsedSec * Math.PI * 4) * 0.35 * weight;
      this.addRotation('rightUpperArm', 0, 0, 0.82 * weight);
      this.addRotation('rightLowerArm', wave, 0, -0.52 * weight);
      this.addRotation('rightHand', 0, 0, -0.2 * weight);
      return;
    }

    if (name === 'nod') {
      const nod = Math.sin(elapsedSec * Math.PI * 2.5) * 0.18 * weight;
      this.addRotation('neck', nod * 0.65, 0, 0);
      this.addRotation('head', nod, 0, 0);
      return;
    }

    if (name === 'shake') {
      const shake = Math.sin(elapsedSec * Math.PI * 3) * 0.2 * weight;
      this.addRotation('neck', 0, shake * 0.6, 0);
      this.addRotation('head', 0, shake, 0);
      return;
    }

    this.addRotation('leftUpperArm', 0, 0, -0.85 * weight);
    this.addRotation('leftLowerArm', -0.15 * weight, 0, 0);
  }

  private addRotation(boneName: VRMHumanBoneName, x: number, y: number, z: number): void {
    const item = this.bones.get(boneName);
    if (!item) {
      return;
    }

    item.bone.rotation.x += x;
    item.bone.rotation.y += y;
    item.bone.rotation.z += z;
  }
}
