import type { ActionName, DebugState, StreamEventType } from './vrmMotion';

declare global {
  interface Window {
    currentVrm: unknown | null;
    vrmExpression?: (expressionName: string, value: number) => void;
    vrmExpressionReset?: () => void;
    vrmAction?: (actionName: ActionName) => void;
    vrmStreamEvent?: (eventType: StreamEventType, chunkIndex?: number) => void;
    vrmDebugState?: DebugState;
  }
}

export {};
