# 0001. Tech stack

- **Status:** Proposed
- **Date:** TBD
- **Deciders:** TBD

## Context

The simulator is web-based and must handle map interaction, a simulation core over millions of grid cells, and interactive firefighting tools. No stack has been chosen.

## Options

### Frontend framework
- React, Vue, Svelte, plain TypeScript, other

### Language for the simulation core
- TypeScript / JavaScript
- Rust (compiled to WebAssembly)
- C++ (compiled to WebAssembly)
- Python (server side)
- GPU compute (WebGPU / WebGL shaders), alone or combined with the above

### Where compute runs
- Browser only (WebGPU/WebGL; feasible for a few million cells)
- Server side (large areas, ensemble runs)
- Hybrid: browser for interactive runs, server for ensembles

## Decision

_None yet. Needs team sign-off._

## Consequences

_To be filled in once decided._
