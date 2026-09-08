# MediQ development starter

This repository contains the working Patient portal and first Staff operations milestone for MediQ, a web-based clinic queue management system. Patient workflows and live Staff queue control are implemented; Staff appointment management, administration and trained machine-learning predictions remain later milestones.

## Current milestone

- Working Node.js and Express application scaffold
- Responsive development-preview interface
- Homepage feature set based on the approved FYP prototype
- Clearly separated Patient, Staff and Administrator access with three sign-in pages
- Public patient registration only; Staff and Administrator accounts are clinic-issued
- Accessible live registration validation and strong-password guidance
- MySQL-backed patient registration, password hashing and secure role-aware sessions
- Protected Patient, Staff and Administrator dashboard entry
- MySQL-backed Patient dashboard, clinic-service selection and queue history
- Transactional daily queue-number generation with duplicate-active-queue prevention
- Patient queue status, transparent baseline waiting estimate and cancellation reason
- Staff operations overview and live service queue management
- Enforced queue ordering, validated status transitions, Patient notifications and Staff audit records
- Patient appointment requests, status tracking and cancellation
- Patient notification inbox with read/unread state
- Filterable queue history, profile editing and secure password changes
- Draft Terms and Conditions and Privacy Notice for supervisor review
- Dedicated, responsive pages for all Patient portal features
- Three-step patient journey section
- Clinic services loaded dynamically from the Express API
- Health and project-status API endpoints
- Configurable MySQL connection
- MySQL schema for users, services, queues, appointments, notifications and predictions
- Small FastAPI prediction-service stub with a clearly labelled baseline calculation
- Automated tests for public pages, authentication, ownership and Patient workflows

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
4. Open `database/schema.sql` and explain the user, queue, appointment and notification relationships.
5. Demonstrate that the clinic-service cards are loaded through `/api/services`.
6. Demonstrate invalid and valid registration values, the live password checklist, password visibility and confirmation matching.
7. Switch among Patient, Staff and Administrator on the homepage and show the separate restricted sign-in pages.
8. Open the Terms and Privacy page and point out the items that the clinic must confirm before deployment.
9. Register a patient, sign in, select a service and join the queue. Show the queue number, position and baseline estimate.
10. Cancel the queue with a reason and show that it remains in the filterable queue history.
11. Request an appointment and show its pending clinic-approval status, then open the notification inbox.
12. Update the Patient profile and demonstrate the password requirements, matching feedback and show/hide controls.
13. Sign in as Staff and show today’s operational totals and service queues.
14. Close and reopen a service queue, then call the earliest waiting patient and move them into consultation.
15. Show the resulting Patient notification and explain that invalid transitions are rejected and Staff actions are audited.
16. Explain that appointment management is the next Staff stage.
17. Explain that the current waiting time is a transparent baseline and will later be replaced by a trained and evaluated regression model.

## Next milestone

The next development milestone should add Staff appointment approval, rejection and rescheduling with booking-conflict protection.
