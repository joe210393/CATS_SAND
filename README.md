# CatLitter MVP

## 1) Setup MySQL
Create DB:
- catlitter_mvp

Import schema:
- sql/schema.sql

V2 migration (same DB, no new database):
- sql/migration_v2.sql
- Apply in MySQL Workbench (or mysql CLI) to the existing `catlitter_mvp` database.

## 2) Config
Copy .env.example to .env and edit DB + LLM settings.

## 3) Install & Run
npm install
npm run dev

## 4) Pages
- 3D Map: http://localhost:3000/map.html
- Admin Samples: http://localhost:3000/admin/samples.html
- Admin Materials: http://localhost:3000/admin/materials.html
- Admin Models: http://localhost:3000/admin/models.html
- Admin Optimizer: http://localhost:3000/admin/optimizer.html
- Admin Swap Repair: http://localhost:3000/admin/swap-repair.html

## 5) Training Guide (ZH)
- `TRAINING_GUIDE_V2_ZH.md`
