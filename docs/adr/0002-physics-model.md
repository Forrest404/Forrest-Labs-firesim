# 0002. Physics model

- **Status:** Proposed
- **Date:** TBD
- **Deciders:** TBD

## Context

The model must be physically grounded and validated against real historical fires, and fast enough for interaction. See the comparison in [ideas.md](../../ideas.md).

## Options

| Approach | Realism | Compute | Notes |
|---|---|---|---|
| Cellular automaton | Low-medium | Very cheap | Good for MVP and interactivity |
| Rothermel + level-set / wavefront (FARSITE/ELMFIRE style) | Medium-high | Moderate | Handles wind, slope, fuel type, moisture |
| Coupled fire-atmosphere (WRF-SFIRE, FIRETEC) | Highest | Supercomputer | Not practical in browser |

Possible staging: cellular automaton for the MVP, Rothermel-based model in v2 (see [ROADMAP.md](../../ROADMAP.md)).

## Decision

_None yet._ ideas.md recommends Rothermel spread equations on a grid with level-set or elliptical wavefront, but this recommendation needs team sign-off.

## Consequences

_To be filled in once decided._
