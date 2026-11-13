CREATE DATABASE IF NOT EXISTS certichain CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE certichain;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','student') NOT NULL DEFAULT 'student',
  student_id VARCHAR(60) NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS certificate_metadata (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  certificate_id VARCHAR(64) NOT NULL UNIQUE,
  student_email VARCHAR(190) NOT NULL,
  title VARCHAR(190) NOT NULL,
  institution VARCHAR(190) NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_email(student_email),
  CONSTRAINT fk_certificate_creator FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_notes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  certificate_id VARCHAR(64) NOT NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_certificate(certificate_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
