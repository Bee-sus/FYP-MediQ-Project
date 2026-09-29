CREATE DATABASE IF NOT EXISTS mediq
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mediq;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone_number VARCHAR(30),
  staff_code VARCHAR(30) NULL UNIQUE,
  profile_picture_url MEDIUMTEXT NULL,
  birth_date DATE NULL,
  gender ENUM('female', 'male', 'other', 'prefer-not-to-say') NULL,
  role ENUM('patient', 'staff', 'admin') NOT NULL DEFAULT 'patient',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_session_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_verification_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS clinic_services (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  doctor_name VARCHAR(120) NULL,
  service_details VARCHAR(500) NULL,
  average_duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  queue_capacity INT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_queue_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_service_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS clinic_settings (
  id TINYINT UNSIGNED PRIMARY KEY,
  clinic_name VARCHAR(120) NOT NULL DEFAULT 'MediQ Clinic',
  address VARCHAR(300) NULL,
  phone VARCHAR(30) NULL,
  timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Kuala_Lumpur'
);
INSERT IGNORE INTO clinic_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS queue_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  queue_date DATE NOT NULL,
  queue_number INT UNSIGNED NOT NULL,
  status ENUM('waiting', 'called', 'in_progress', 'completed', 'skipped', 'cancelled') NOT NULL DEFAULT 'waiting',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at TIMESTAMP NULL,
  consultation_started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  cancellation_reason VARCHAR(300) NULL,
  CONSTRAINT fk_queue_patient FOREIGN KEY (patient_id) REFERENCES users(id),
  CONSTRAINT fk_queue_service FOREIGN KEY (service_id) REFERENCES clinic_services(id),
  CONSTRAINT uq_service_daily_queue UNIQUE (service_id, queue_date, queue_number),
  INDEX idx_active_queue (service_id, queue_date, status)
);

CREATE TABLE IF NOT EXISTS waiting_time_predictions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  queue_entry_id BIGINT UNSIGNED NOT NULL,
  estimated_minutes DECIMAL(6,2) NOT NULL,
  model_version VARCHAR(80) NOT NULL,
  predicted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  people_ahead INT UNSIGNED NULL,
  service_duration_minutes INT UNSIGNED NULL,
  joined_hour TINYINT UNSIGNED NULL,
  joined_weekday TINYINT UNSIGNED NULL,
  actual_wait_minutes DECIMAL(6,2) NULL,
  CONSTRAINT fk_prediction_queue FOREIGN KEY (queue_entry_id) REFERENCES queue_entries(id)
);

CREATE TABLE IF NOT EXISTS appointment_booking_lock (
  id TINYINT UNSIGNED PRIMARY KEY
);
INSERT IGNORE INTO appointment_booking_lock (id) VALUES (1);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  notes VARCHAR(500) NULL,
  status ENUM('pending', 'approved', 'rejected', 'completed', 'cancelled', 'reschedule_proposed') NOT NULL DEFAULT 'pending',
  rejection_reason VARCHAR(300) NULL,
  cancelled_at TIMESTAMP NULL,
  reminder_sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_appointment_patient FOREIGN KEY (patient_id) REFERENCES users(id),
  CONSTRAINT fk_appointment_service FOREIGN KEY (service_id) REFERENCES clinic_services(id),
  INDEX idx_patient_appointments (patient_id, appointment_date, status),
  INDEX idx_clinic_appointments (appointment_date, appointment_time, status)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  queue_entry_id BIGINT UNSIGNED NULL,
  appointment_id BIGINT UNSIGNED NULL,
  title VARCHAR(120) NOT NULL,
  message VARCHAR(500) NOT NULL,
  notification_type ENUM('queue', 'appointment', 'account', 'system') NOT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_queue FOREIGN KEY (queue_entry_id) REFERENCES queue_entries(id) ON DELETE SET NULL,
  CONSTRAINT fk_notification_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  INDEX idx_patient_notifications (patient_id, read_at, created_at)
);

CREATE TABLE IF NOT EXISTS staff_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  staff_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type ENUM('queue_entry', 'clinic_service', 'appointment') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  details VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_staff FOREIGN KEY (staff_id) REFERENCES users(id),
  INDEX idx_staff_audit (staff_id, created_at),
  INDEX idx_entity_audit (entity_type, entity_id)
);

INSERT INTO clinic_services (name, description, average_duration_minutes)
VALUES
  ('General Consultation', 'Standard consultation with a clinic doctor.', 15),
  ('Follow-up Consultation', 'Follow-up visit for an existing condition.', 10),
  ('Dental Consultation', 'Assessment and consultation for common dental concerns.', 20),
  ('Specialist Consultation', 'Consultation requested with an available clinic specialist.', 25),
  ('Pharmacy Collection', 'Collection of medication prepared by the clinic pharmacy.', 5)
ON DUPLICATE KEY UPDATE description = VALUES(description), average_duration_minutes = VALUES(average_duration_minutes);
