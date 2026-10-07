'use strict';

const { Signal, Stage, Direction } = require('./models');

function deriveSignals(stage, phase, config) {
  const signals = {
    [Direction.NORTH]: Signal.RED,
    [Direction.SOUTH]: Signal.RED,
    [Direction.EAST]: Signal.RED,
    [Direction.WEST]: Signal.RED,
  };

  if (stage === Stage.ALL_RED || !phase) {
    return signals;
  }

  const activeDirections = config.phases[phase] || [];
  const activeSignal = stage === Stage.GREEN ? Signal.GREEN : Signal.YELLOW;

  for (const dir of activeDirections) {
    signals[dir] = activeSignal;
  }

  return signals;
}

module.exports = {
  deriveSignals,
};
