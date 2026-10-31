/**
 * Emergency response simulation ("containment"): crews, engines, dozers and aircraft dispatched
 * against the fire, built as timed firebreak / water interventions on the frozen contract.
 * Pure and worker-safe; the UI lives in src/ui/contain.ts, the 3D markers in src/viewer/dispatchOverlay.ts.
 */

export * from './units';
export * from './stations';
export * from './lines';
export * from './metrics';
export * from './planner';
export * from './kinematics';
