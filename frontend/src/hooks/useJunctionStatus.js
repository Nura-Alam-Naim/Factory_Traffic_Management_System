import { useState, useEffect } from 'react';

export function useJunctionStatus(junctionId) {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!junctionId) return;

    let eventSource;
    let pollInterval;

    const fetchInitial = async () => {
      try {
        const [stateRes, historyRes] = await Promise.all([
          fetch(`/api/junctions/${junctionId}/state`),
          fetch(`/api/junctions/${junctionId}/history`)
        ]);
        if (stateRes.ok) setState(await stateRes.json());
        if (historyRes.ok) setHistory(await historyRes.json());
      } catch (err) {
        setError(err.message);
      }
    };

    const setupSSE = () => {
      eventSource = new EventSource(`/api/junctions/${junctionId}/stream`);
      
      eventSource.onopen = () => {
        setConnected(true);
        setError(null);
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      };

      eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        setState(data);
        // Fire a background fetch for history so it updates too
        fetch(`/api/junctions/${junctionId}/history`)
          .then(res => res.json())
          .then(data => setHistory(data))
          .catch(() => {});
      };

      eventSource.onerror = () => {
        setConnected(false);
        eventSource.close();
        // Fallback to polling
        if (!pollInterval) {
          pollInterval = setInterval(fetchInitial, 2000);
        }
        // Try to reconnect SSE after 5s
        setTimeout(setupSSE, 5000);
      };
    };

    fetchInitial().then(setupSSE);

    return () => {
      if (eventSource) eventSource.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [junctionId]);

  return { state, history, connected, error };
}
