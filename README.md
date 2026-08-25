# MediQ development starter

This repository contains the initial development milestone for MediQ, a web-based clinic queue management system. It intentionally establishes only the system foundation; authentication, queue operations, appointments and trained machine-learning predictions are planned for later milestones.

## Current milestone

- Working Node.js and Express application scaffold
- Responsive development-preview interface
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
4. Install dependencies and start the server:

```bash
npm install
npm run dev
```

5. Open `http://localhost:3000`.

The preview page still runs if MySQL has not been configured; its health label will report that the database is not connected.

## Run the prediction-service stub

Open `ml-service` in PyCharm, create a virtual environment, and run:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API documentation will be available at `http://127.0.0.1:8000/docs`.

## Suggested supervisor demonstration

1. Show the folder structure and explain the client-server separation.
2. Start the Node.js server and open the development-preview page.
3. Visit `http://localhost:3000/api/project-status` to show the first backend endpoint.
4. Open `database/schema.sql` and explain the first four entities.
5. Explain that the FastAPI endpoint currently uses a transparent baseline and will later be replaced by a trained and evaluated regression model.

## Next milestone

The next development milestone should implement registration/login with patient and staff roles, followed by the transactional queue-joining workflow.
