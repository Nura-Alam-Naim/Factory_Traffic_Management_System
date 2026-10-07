'use strict';

class FakeClock {
  constructor(nowMs = 0) {
    this._now = nowMs;
  }

  now() {
    return this._now;
  }

  advance(ms) {
    this._now += ms;
  }

  set(ms) {
    this._now = ms;
  }
}

module.exports = { FakeClock };
