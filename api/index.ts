import { handle } from 'hono/vercel';
import { app } from '../server';

// Vercel serverless function entrypoint
export default handle(app);
