CREATE TABLE IF NOT EXISTS material_models (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  metric VARCHAR(50) NOT NULL,
  expression TEXT NOT NULL,
  params_json JSON NULL,
  variables_json JSON NULL,
  version VARCHAR(20) NOT NULL DEFAULT 'v1',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  KEY idx_material_models_material_metric (material_id, metric),
  KEY idx_material_models_active (material_id, metric, is_active)
);

CREATE TABLE IF NOT EXISTS recipe_constraints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  role ENUM('main','secondary','any') NOT NULL DEFAULT 'any',
  min_ratio DECIMAL(6,2) NULL,
  max_ratio DECIMAL(6,2) NULL,
  priority INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  KEY idx_recipe_constraints_material (material_id),
  KEY idx_recipe_constraints_enabled (enabled, role)
);
