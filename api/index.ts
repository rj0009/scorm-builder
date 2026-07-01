import { handle } from 'hono/vercel';
import { app } from '../server-lib/app';

export default handle(app);
