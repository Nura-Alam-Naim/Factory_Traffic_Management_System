import React from 'react';

const SignalLight = ({ direction, desired, actual }) => {
  const colors = {
    RED: '#ef4444',
    YELLOW: '#eab308',
    GREEN: '#22c55e',
    UNKNOWN: '#6b7280'
  };

  const getStyle = (val) => ({
    backgroundColor: colors[val] || colors.UNKNOWN,
    boxShadow: val !== 'RED' && val !== 'UNKNOWN' ? `0 0 15px ${colors[val]}` : 'none'
  });

  return (
    <div className={`signal-light ${direction.toLowerCase()}`}>
      <span className="direction-label">{direction}</span>
      <div className="light-housing">
        <div className="actual-light" style={getStyle(actual)}></div>
        <div className="desired-ring" style={{ borderColor: colors[desired] || colors.UNKNOWN }}></div>
      </div>
    </div>
  );
};

export function IntersectionView({ state }) {
  if (!state) return <div className="skeleton-intersection"></div>;

  const { desiredSignals, actualSignals } = state;

  return (
    <div className="intersection-container">
      <div className="road vertical-road"></div>
      <div className="road horizontal-road"></div>
      
      <div className="intersection-center">
        <SignalLight direction="NORTH" desired={desiredSignals.NORTH} actual={actualSignals.NORTH} />
        <SignalLight direction="SOUTH" desired={desiredSignals.SOUTH} actual={actualSignals.SOUTH} />
        <SignalLight direction="EAST" desired={desiredSignals.EAST} actual={actualSignals.EAST} />
        <SignalLight direction="WEST" desired={desiredSignals.WEST} actual={actualSignals.WEST} />
      </div>
    </div>
  );
}
