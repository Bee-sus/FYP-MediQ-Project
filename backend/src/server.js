require('dotenv').config();
const app = require('./app');

const port = Number(process.env.PORT || 3100);

app.listen(port, () => {
  console.log(`MediQ development server is running at http://localhost:${port}`);
});
