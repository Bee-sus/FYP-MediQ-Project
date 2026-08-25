const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const systemRoutes = require('./routes/systemRoutes');
const serviceRoutes = require('./routes/serviceRoutes');

const app = express();
const frontendDirectory = path.join(__dirname, '../../frontend');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api', systemRoutes);
app.use('/api/services', serviceRoutes);
app.use(express.static(frontendDirectory));

app.get('*', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'));
});

module.exports = app;
