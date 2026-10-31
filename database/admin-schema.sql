CREATE TABLE IF NOT EXISTS clinic_schedule_state (
  id TINYINT UNSIGNED PRIMARY KEY,
  revision INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;
INSERT IGNORE INTO clinic_schedule_state (id) VALUES (1);

CREATE TABLE IF NOT EXISTS clinic_hours (
  day_of_week TINYINT UNSIGNED PRIMARY KEY,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  opens_at TIME NOT NULL DEFAULT '09:00:00',
  closes_at TIME NOT NULL DEFAULT '17:00:00',
  break_start TIME NULL DEFAULT '12:00:00',
  break_end TIME NULL DEFAULT '14:00:00',
  CONSTRAINT ck_hours_weekday CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT ck_hours_window CHECK (opens_at >= '00:00:00' AND closes_at < '24:00:00' AND opens_at < closes_at AND MOD(TIME_TO_SEC(opens_at), 1800) = 0 AND MOD(TIME_TO_SEC(closes_at), 1800) = 0),
  CONSTRAINT ck_hours_break CHECK ((break_start IS NULL AND break_end IS NULL) OR (break_start IS NOT NULL AND break_end IS NOT NULL AND break_start >= opens_at AND break_end <= closes_at AND break_start < break_end AND MOD(TIME_TO_SEC(break_start), 1800) = 0 AND MOD(TIME_TO_SEC(break_end), 1800) = 0))
) ENGINE=InnoDB;
INSERT IGNORE INTO clinic_hours (day_of_week) VALUES (0),(1),(2),(3),(4),(5),(6);

CREATE TABLE IF NOT EXISTS clinic_closures (
  closure_date DATE PRIMARY KEY,
  reason VARCHAR(200) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_closure_admin FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  details VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_audit_user FOREIGN KEY (admin_id) REFERENCES users(id),
  INDEX idx_admin_audit_time (created_at, id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS patient_email_codes (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  session_hash CHAR(64) NOT NULL UNIQUE,
  session_expires_at DATETIME NOT NULL,
  code_hash CHAR(64) NULL,
  expires_at DATETIME NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  sent_at DATETIME NULL,
  send_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  send_window DATETIME NULL,
  CONSTRAINT fk_patient_email_code_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
