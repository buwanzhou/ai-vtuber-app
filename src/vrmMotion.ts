export type ActionName = 'reset' | 'wave' | 'nod' | 'shake' | 'raiseLeftArm';

export type StreamEventType = 'chunk' | 'sentence_end' | 'idle_timeout';

export type MotionEventCode =
  | 'MODEL_READY'
  | 'MODEL_NOT_READY'
  | 'ACTION_STARTED'
  | 'ACTION_FINISHED'
  | 'ACTION_REJECTED_RATE_LIMIT'
  | 'ACTION_REJECTED_UNSUPPORTED'
  | 'ACTION_REJECTED_MODEL_NOT_READY'
  | 'BONE_MISSING'
  | 'POSE_RESET';

export interface MotionEvent {
  ts: number;
  code: MotionEventCode;
  message: string;
  meta?: Record<string, unknown>;
}

export interface DebugState {
  modelReady: boolean;
  currentAction: ActionName;
  lastErrorCode: MotionEventCode | null;
  events: MotionEvent[];
}

interface ActionConfig {
  durationSec: number;
  minTriggerGapSec: number;
}

const ACTION_CONFIG: Record<Exclude<ActionName, 'reset'>, ActionConfig> = {
  wave: { durationSec: 2.2, minTriggerGapSec: 0.5 },
  nod: { durationSec: 1.2, minTriggerGapSec: 0.35 },
  shake: { durationSec: 1.2, minTriggerGapSec: 0.35 },
  raiseLeftArm: { durationSec: 2.5, minTriggerGapSec: 0.7 },
};

const SUPPORTED_ACTIONS: ActionName[] = ['reset', 'wave', 'nod', 'shake', 'raiseLeftArm'];

export interface RequestActionResult {
  accepted: boolean;
  code?: MotionEventCode;
  message?: string;
}

export interface MotionScheduler {
  requestAction: (action: ActionName, nowSec: number) => RequestActionResult;
  tick: (deltaSec: number) => { shouldResetPose: boolean; finishedAction: ActionName | null };
  getCurrentAction: () => ActionName;
  getActionTimeSec: () => number;
}

export function createMotionScheduler(): MotionScheduler {
  let currentAction: ActionName = 'reset';
  let actionTimeSec = 0;
  const lastAcceptedAtSec: Record<Exclude<ActionName, 'reset'>, number> = {
    wave: -Infinity,
    nod: -Infinity,
    shake: -Infinity,
    raiseLeftArm: -Infinity,
  };

  function requestAction(action: ActionName, nowSec: number): RequestActionResult {
    if (!SUPPORTED_ACTIONS.includes(action)) {
      return {
        accepted: false,
        code: 'ACTION_REJECTED_UNSUPPORTED',
        message: `Unsupported action: ${action}`,
      };
    }

    if (action === 'reset') {
      currentAction = 'reset';
      actionTimeSec = 0;
      return { accepted: true };
    }

    const cfg = ACTION_CONFIG[action];
    if (nowSec - lastAcceptedAtSec[action] < cfg.minTriggerGapSec) {
      return {
        accepted: false,
        code: 'ACTION_REJECTED_RATE_LIMIT',
        message: `Rate limited action: ${action}`,
      };
    }

    currentAction = action;
    actionTimeSec = 0;
    lastAcceptedAtSec[action] = nowSec;
    return { accepted: true };
  }

  function tick(deltaSec: number): { shouldResetPose: boolean; finishedAction: ActionName | null } {
    if (currentAction === 'reset') {
      return { shouldResetPose: false, finishedAction: null };
    }

    actionTimeSec += deltaSec;
    const duration = ACTION_CONFIG[currentAction].durationSec;
    if (actionTimeSec >= duration) {
      const finishedAction = currentAction;
      currentAction = 'reset';
      actionTimeSec = 0;
      return { shouldResetPose: true, finishedAction };
    }

    return { shouldResetPose: false, finishedAction: null };
  }

  return {
    requestAction,
    tick,
    getCurrentAction: () => currentAction,
    getActionTimeSec: () => actionTimeSec,
  };
}

export function mapStreamEventToAction(eventType: StreamEventType, chunkIndex: number): ActionName {
  if (eventType === 'sentence_end') {
    return 'nod';
  }
  if (eventType === 'idle_timeout') {
    return 'reset';
  }
  return chunkIndex % 2 === 0 ? 'nod' : 'wave';
}
