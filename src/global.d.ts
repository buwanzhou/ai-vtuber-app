import type { ActionName, DebugState, StreamEventType } from './vrmMotion';
import type { VrmAiCommand } from './vrmActionController';

declare global {
  interface Window {
    currentVrm: unknown | null;
    vrmExpression?: (expressionName: string, value: number) => void;
    vrmExpressionReset?: () => void;
    vrmAction?: (actionName: ActionName) => void;
    vrmStreamEvent?: (eventType: StreamEventType, chunkIndex?: number) => void;
    vrmAICommand?: (command: VrmAiCommand) => void;
    vrmDebugState?: DebugState;
  }
}

export {};
