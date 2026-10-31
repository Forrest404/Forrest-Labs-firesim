// Entry point. Stage 1 placeholder: proves the toolchain boots. Replaced by real wiring in
// Stage 4 (viewer) and Stage 5 (core loop).
import { CONTRACT_VERSION } from '../contract';

const panel = document.getElementById('panel');
if (panel) {
  panel.textContent = `Wildfire Sim scaffold (contract v${CONTRACT_VERSION}). Simplified model. Not for real-world decisions.`;
}
