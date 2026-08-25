CREATE DATABASE IF NOT EXISTS mediq
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mediq;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone_number VARCHAR(30),
  role ENUM('patient', 'staff', 'admin') NOT NULL DEFAULT 'patient',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE clinic_services (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  average_duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE queue_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  queue_date DATE NOT NULL,
  queue_number INT UNSIGNED NOT NULL,
  status ENUM('waiting', 'called', 'in_progress', 'completed', 'skipped', 'cancelled') NOT NULL DEFAULT 'waiting',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  CONSTRAINT fk_queue_patient FOREIGN KEY (patient_id) REFERENCES users(id),
  CONSTRAINT fk_queue_service FOREIGN KEY (service_id) REFERENCES clinic_services(id),
  CONSTRAINT uq_service_daily_queue UNIQUE (service_id, queue_date, queue_number),
  INDEX idx_active_queue (service_id, queue_date, status)
);

CREATE TABLE waiting_time_predictions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  queue_entry_id BIGINT UNSIGNED NOT NULL,
  estimated_minutes DECIMAL(6,2) NOT NULL,
  model_version VARCHAR(80) NOT NULL,
  predicted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prediction_queue FOREIGN KEY (queue_entry_id) REFERENCES queue_entries(id)
);

INSERT INTO clinic_services (name, description, average_duration_minutes)
VALUES
  ('General Consultation', 'Standard consultation with a clinic doctor.', 15),
  ('Follow-up Consultation', 'Follow-up visit for an existing condition.', 10);
