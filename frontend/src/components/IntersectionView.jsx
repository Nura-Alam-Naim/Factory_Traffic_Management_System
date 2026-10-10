import React from 'react';

const SignalLight = ({ direction, desired, actual }) => {
  const colors = {
    RED: '#ef4444',
    YELLOW: '#f59e0b',
    GREEN: '#10b981',
    UNKNOWN: '#475569'
  };
  
  const glow = {
    RED: 'rgba(239, 68, 68, 0.6)',
    YELLOW: 'rgba(245, 158, 11, 0.6)',
    GREEN: 'rgba(16, 185, 129, 0.6)',
    UNKNOWN: 'rgba(0, 0, 0, 0)'
  };

  const getStyle = (val) => ({
    backgroundColor: colors[val] || colors.UNKNOWN,
    boxShadow: val !== 'UNKNOWN' ? `0 0 20px ${glow[val]}, inset 0 2px 4px rgba(255,255,255,0.4)` : 'none'
  });

  const animating = desired !== actual && desired !== 'UNKNOWN';

  return (
    <div className={`signal-light ${direction.toLowerCase()}`}>
      <span className="direction-label">{direction}</span>
      <div className="light-housing">
        <div className="actual-light" style={getStyle(actual)}></div>
        <div 
          className={`desired-ring ${animating ? 'animating' : ''}`} 
          style={{ borderColor: colors[desired] || colors.UNKNOWN }}
        ></div>
      </div>
    </div>
  );
};

const VehicleQueue = ({ direction, queue }) => {
  // Sort vehicles by sequence to order them in the queue correctly
  const vehicles = Object.values(queue || {}).sort((a, b) => a.seq - b.seq);
  
  return (
    <>
      {vehicles.map((v, idx) => {
        // Calculate position offset backwards from the stop line
        let offset = 90 + (idx * 45); // Adjust spacing based on vehicle types in a real app
        
        const style = {};
        if (direction === 'NORTH') style.bottom = `calc(50% + ${offset}px)`;
        if (direction === 'SOUTH') style.top = `calc(50% + ${offset}px)`;
        if (direction === 'EAST') style.left = `calc(50% + ${offset}px)`;
        if (direction === 'WEST') style.right = `calc(50% + ${offset}px)`;
        
        return (
          <div 
            key={v.id || idx} 
            className={`vehicle dir-${direction} type-${v.type || 'CAR'}`}
            style={style}
            title={`${v.type} arrived at ${new Date(v.receivedAt).toLocaleTimeString()}`}
          />
        );
      })}
    </>
  );
};

export function IntersectionView({ state }) {
  if (!state) return <div className="skeleton-intersection"></div>;

  const { desiredSignals, actualSignals, queues } = state;

  return (
    <div className="intersection-container">
      <div className="road vertical-road"></div>
      <div className="road horizontal-road"></div>
      
      {/* Pedestrian Crossings */}
      <div className="crossing north"></div>
      <div className="crossing south"></div>
      <div className="crossing east"></div>
      <div className="crossing west"></div>
      
      <div className="intersection-center">
        <SignalLight direction="NORTH" desired={desiredSignals.NORTH} actual={actualSignals.NORTH} />
        <SignalLight direction="SOUTH" desired={desiredSignals.SOUTH} actual={actualSignals.SOUTH} />
        <SignalLight direction="EAST" desired={desiredSignals.EAST} actual={actualSignals.EAST} />
        <SignalLight direction="WEST" desired={desiredSignals.WEST} actual={actualSignals.WEST} />
      </div>
      
      {/* Render Vehicles */}
      {queues && (
        <>
          <VehicleQueue direction="NORTH" queue={queues.NORTH} />
          <VehicleQueue direction="SOUTH" queue={queues.SOUTH} />
          <VehicleQueue direction="EAST" queue={queues.EAST} />
          <VehicleQueue direction="WEST" queue={queues.WEST} />
        </>
      )}
    </div>
  );
}
