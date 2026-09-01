# MediQ development starter

This repository contains the initial development milestone for MediQ, a web-based clinic queue management system. It intentionally establishes only the system foundation; authentication, queue operations, appointments and trained machine-learning predictions are planned for later milestones.

## Current milestone

- Working Node.js and Express application scaffold
- Responsive development-preview interface
- Homepage feature set based on the approved FYP prototype
- Clearly separated Patient, Staff and Administrator access with three sign-in pages
- Public patient registration only; Staff and Administrator accounts are clinic-issued
- Accessible live registration validation and strong-password guidance
- MySQL-backed patient registration, password hashing and secure role-aware sessions
- Protected Patient, Staff and Administrator dashboard entry
- Draft Terms and Conditions and Privacy Notice for supervisor review
- Smart queue, appointment and notification feature cards
- Three-step patient journey section
- Clinic services loaded dynamically from the Express API
- Health and project-status API endpoints
- Configurable MySQL connection
- Initial database schema for users, services, queues and predictions
- Small FastAPI prediction-service stub with a clearly labelled baseline calculation
- First automated API test

## Project structure

```text
backend/       Node.js and Express application
frontend/      HTML, CSS and browser-side JavaScript
database/      Initial MySQL schema
ml-service/    Python/FastAPI prediction-service boundary
```

## Run the web application

1. Install Node.js and MySQL.
2. Copy `.env.example` to `.env` and update the database settings.
3. Run `database/schema.sql` using MySQL Workbench.
   Alternatively, add your database credentials and controlled demo accounts to `.env`, then run `npm run db:setup`.
4. Install dependencies and start the server:

```bash
npm install
npm run dev
```

5. Open `http://localhost:3000`. If that port is already occupied, set another one first, for example `$env:PORT=3100` in PowerShell.

The public pages still load if MySQL has not been configured, but registration and sign-in will clearly report that account services are unavailable.

Staff and Administrator accounts are never publicly registered. Configure `SEED_STAFF_*` and `SEED_ADMIN_*` in `.env`; `npm run db:setup` creates or refreshes those controlled demonstration accounts using scrypt password hashes.

## Run the prediction-service stub

Open `ml-service` in PyCharm, create a virtual environment, and run:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API documentation will be available at `http://127.0.0.1:8000/docs`.

## Suggested supervisor demonstration

1. Show the folder structure and explain the client-server separation.
2. Start the Node.js server and demonstrate the completed homepage sections.
3. Visit `http://localhost:3000/api/project-status` to show the first backend endpoint.
4. Open `database/schema.sql` and explain the first four entities.
5. Demonstrate that the clinic-service cards are loaded through `/api/services`.
6. Demonstrate invalid and valid registration values, the live password checklist, password visibility and confirmation matching.
7. Switch among Patient, Staff and Administrator on the homepage and show the separate restricted sign-in pages.
8. Open the Terms and Privacy page and point out the items that the clinic must confirm before deployment.
9. Register a patient, sign in, show the role-aware dashboard and sign out. Explain that appointment submission, queue operations and notifications are the next backend workflows.
10. Explain that the FastAPI endpoint currently uses a transparent baseline and will later be replaced by a trained and evaluated regression model.

## Next milestone

The next development milestone should implement registration/login with patient and staff roles, followed by the transactional queue-joining workflow.
