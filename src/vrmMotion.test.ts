import { describe, expect, it } from 'vitest';
import { createMotionScheduler, mapStreamEventToAction } from './vrmMotion';

describe('createMotionScheduler', () => {
  it('accepts action and auto resets after duration', () => {
    const scheduler = createMotionScheduler();

    const start = scheduler.requestAction('nod', 0);
    expect(start.accepted).toBe(true);
    expect(scheduler.getCurrentAction()).toBe('nod');

    const step = scheduler.tick(1.3);
    expect(step.shouldResetPose).toBe(true);
    expect(step.finishedAction).toBe('nod');
    expect(scheduler.getCurrentAction()).toBe('reset');
  });

  it('rate limits same action in short interval', () => {
    const scheduler = createMotionScheduler();

    expect(scheduler.requestAction('wave', 1).accepted).toBe(true);
    const second = scheduler.requestAction('wave', 1.2);

    expect(second.accepted).toBe(false);
    expect(second.code).toBe('ACTION_REJECTED_RATE_LIMIT');
  });

  it('allows manual reset anytime', () => {
    const scheduler = createMotionScheduler();
    scheduler.requestAction('shake', 1);

    const reset = scheduler.requestAction('reset', 1.1);
    expect(reset.accepted).toBe(true);
    expect(scheduler.getCurrentAction()).toBe('reset');
  });
});

describe('mapStreamEventToAction', () => {
  it('maps sentence end to nod', () => {
    expect(mapStreamEventToAction('sentence_end', 10)).toBe('nod');
  });

  it('maps idle timeout to reset', () => {
    expect(mapStreamEventToAction('idle_timeout', 10)).toBe('reset');
  });

  it('alternates chunk action by chunk index', () => {
    expect(mapStreamEventToAction('chunk', 1)).toBe('wave');
    expect(mapStreamEventToAction('chunk', 2)).toBe('nod');
  });
});
