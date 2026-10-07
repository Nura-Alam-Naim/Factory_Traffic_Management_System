'use strict';

const { Stage, DeviceStatus } = require('./models');

function getPhaseStats(state, phase, now) {
  let score = 0;
  let oldestWaitMs = 0;
  let hasTraffic = false;
  let hasOfflineSensor = false;

  const weights = state.config.scoring.weights;
  const waitFactor = state.config.scoring.waitFactor;
  const dirs = state.config.phases[phase] || [];

  for (const dir of dirs) {
    // Check if sensor is offline
    if (state.devices.sensors[dir] === DeviceStatus.OFFLINE) {
      hasOfflineSensor = true;
    }

    const queue = state.queues[dir] || {};
    for (const v of Object.values(queue)) {
      hasTraffic = true;
      score += weights[v.type] || weights.EMPLOYEE;
      
      const waitTime = Math.max(0, now - v.receivedAt);
      if (waitTime > oldestWaitMs) {
        oldestWaitMs = waitTime;
      }
    }
  }

  // Add wait time factor (score per second waiting)
  score += (oldestWaitMs / 1000) * waitFactor;

  // Starvation protection
  if (oldestWaitMs > state.config.scoring.maxWaitMs) {
    score += state.config.scoring.starvationBonus;
  }

  // Periodic service if a sensor is offline and we might be missing arrivals
  if (!hasTraffic && hasOfflineSensor) {
    // Arbitrary base score to ensure it eventually gets serviced if the other side isn't overwhelmingly busy
    score += 5; 
  }

  return { score, hasTraffic, oldestWaitMs };
}

function choosePhase(state, now) {
  // If we are ALL_RED and have no phase, we can pick the highest score
  const currentPhase = state.phase || (state.stage === Stage.ALL_RED ? state.nextPhase : null);
  
  // If no phase is active at all (e.g. boot to AUTOMATIC), pick the first one with traffic
  if (!currentPhase) {
    const phases = Object.keys(state.config.phases);
    let best = phases[0];
    let bestScore = -1;
    for (const p of phases) {
      const stats = getPhaseStats(state, p, now);
      if (stats.score > bestScore) {
        bestScore = stats.score;
        best = p;
      }
    }
    return { switch: true, target: best, reason: `Initial phase ${best}` };
  }

  const conflicts = state.config.conflicts[currentPhase] || [];
  if (conflicts.length === 0) {
    return { switch: false, target: currentPhase, reason: 'No conflicting phases' };
  }

  const currentStats = getPhaseStats(state, currentPhase, now);
  
  let bestOther = null;
  let bestOtherStats = { score: -1, hasTraffic: false, oldestWaitMs: 0 };

  for (const p of conflicts) {
    const stats = getPhaseStats(state, p, now);
    if (stats.score > bestOtherStats.score) {
      bestOtherStats = stats;
      bestOther = p;
    }
  }

  if (!bestOther) {
    return { switch: false, target: currentPhase, reason: 'No competitors' };
  }

  // Both empty -> stay
  if (!currentStats.hasTraffic && !bestOtherStats.hasTraffic) {
    return { switch: false, target: currentPhase, reason: 'Both phases empty' };
  }

  // Min green constraint
  if (state.stage === Stage.GREEN && state.stageConfirmedAt !== null) {
    const elapsed = now - state.stageConfirmedAt;
    if (elapsed < state.config.timings.minGreenMs) {
      return { switch: false, target: currentPhase, reason: 'Min green not met' };
    }

    // Max green constraint
    if (elapsed >= state.config.timings.maxGreenMs && bestOtherStats.hasTraffic) {
      return { switch: true, target: bestOther, reason: 'Max green reached' };
    }
  }

  // Current empty, other has traffic
  if (!currentStats.hasTraffic && bestOtherStats.hasTraffic) {
    return { switch: true, target: bestOther, reason: 'Current empty, other waiting' };
  }

  // Starvation override
  if (bestOtherStats.oldestWaitMs > state.config.scoring.maxWaitMs) {
    return { switch: true, target: bestOther, reason: `Starvation on ${bestOther} > ${state.config.scoring.maxWaitMs}ms` };
  }

  // Hysteresis calculation
  const currentThreshold = currentStats.score * state.config.scoring.hysteresis;
  if (bestOtherStats.score > currentThreshold) {
    const r = `${bestOther} score ${bestOtherStats.score.toFixed(1)} > ${currentPhase} ${currentStats.score.toFixed(1)} * ${state.config.scoring.hysteresis}`;
    return { switch: true, target: bestOther, reason: r };
  }

  return { switch: false, target: currentPhase, reason: `Score not sufficient to overcome hysteresis` };
}

module.exports = {
  getPhaseStats,
  choosePhase,
};
