-- IF NOT EXISTS makes it idempotent
CREATE TABLE IF NOT EXISTS junctions (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  config JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS junction_state (
  junction_id VARCHAR(64) PRIMARY KEY,
  state JSON NOT NULL,
  version INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (junction_id) REFERENCES junctions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS queue_vehicles (
  junction_id VARCHAR(64),
  vehicle_id VARCHAR(128),
  direction VARCHAR(32) NOT NULL,
  vehicle_type VARCHAR(32) NOT NULL,
  arrived_at BIGINT NOT NULL,
  seq INT NOT NULL,
  PRIMARY KEY (junction_id, vehicle_id),
  FOREIGN KEY (junction_id) REFERENCES junctions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tombstones (
  junction_id VARCHAR(64),
  vehicle_id VARCHAR(128),
  seq INT NOT NULL,
  cleared_at BIGINT NOT NULL,
  PRIMARY KEY (junction_id, vehicle_id),
  FOREIGN KEY (junction_id) REFERENCES junctions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS processed_events (
  event_id VARCHAR(128) PRIMARY KEY,
  junction_id VARCHAR(64) NOT NULL,
  received_at BIGINT NOT NULL,
  FOREIGN KEY (junction_id) REFERENCES junctions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS commands (
  command_id VARCHAR(128) PRIMARY KEY,
  junction_id VARCHAR(64) NOT NULL,
  requested JSON NOT NULL,
  status VARCHAR(64) NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  sent_at BIGINT NOT NULL,
  acked_at BIGINT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (junction_id) REFERENCES junctions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  junction_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  reason VARCHAR(512),
  details JSON,
  created_at BIGINT NOT NULL,
  INDEX idx_junction_time (junction_id, created_at),
  INDEX idx_event_type (event_type),
  FOREIGN KEY (junction_id) REFERENCES junctions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_status (
  junction_id VARCHAR(64),
  device_id VARCHAR(128),
  device_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (junction_id, device_id),
  FOREIGN KEY (junction_id) REFERENCES junctions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rejected_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  payload JSON,
  error_code INT NOT NULL,
  message TEXT,
  received_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
