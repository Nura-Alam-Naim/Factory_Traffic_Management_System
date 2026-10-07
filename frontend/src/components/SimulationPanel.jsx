import React, { useState } from 'react';

export function SimulationPanel({ junctionId }) {
  const [adminId, setAdminId] = useState('admin_1');

  const sendSensor = async (direction, type, eventType = 'VEHICLE_ARRIVED') => {
    await fetch(`/api/junctions/${junctionId}/sensor-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: `sim_${Date.now()}_${Math.floor(Math.random()*1000)}`,
        direction,
        vehicleId: `veh_${Date.now()}`,
        vehicleType: type,
        type: eventType,
        sequenceNo: Date.now() % 10000,
        timestamp: Date.now()
      })
    });
  };

  const sendManual = async (direction) => {
    await fetch(`/api/junctions/${junctionId}/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId, direction })
    });
  };

  const sendAuto = async () => {
    await fetch(`/api/junctions/${junctionId}/automatic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId })
    });
  };

  return (
    <div className="panel simulation-panel glassmorphism">
      <h3>Control Panel</h3>
      
      <div className="control-group">
        <h4>Trigger Sensors</h4>
        <div className="button-grid">
          <button onClick={() => sendSensor('NORTH', 'TRUCK')}>N Truck Arrives</button>
          <button onClick={() => sendSensor('SOUTH', 'FORKLIFT')}>S Forklift Arrives</button>
          <button onClick={() => sendSensor('EAST', 'EMPLOYEE')}>E Employee Arrives</button>
          <button onClick={() => sendSensor('WEST', 'TRUCK')}>W Truck Arrives</button>
        </div>
        <div className="button-grid mt-2">
          <button className="btn-emergency" onClick={() => sendSensor('NORTH', 'EMERGENCY')}>🚨 N Emergency!</button>
          <button className="btn-emergency" onClick={() => sendSensor('EAST', 'EMERGENCY')}>🚨 E Emergency!</button>
        </div>
      </div>

      <div className="control-group mt-4">
        <h4>Manual Override (Admin: {adminId})</h4>
        <div className="button-grid">
          <button className="btn-manual" onClick={() => sendManual('NORTH')}>Hold NS Green</button>
          <button className="btn-manual" onClick={() => sendManual('EAST')}>Hold EW Green</button>
          <button className="btn-auto" onClick={sendAuto}>Return to Auto</button>
        </div>
      </div>
    </div>
  );
}
