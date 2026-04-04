import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { verifyToken } from '../lib/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    authenticated: boolean;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, _reply) => {
    request.userId = null;
    request.authenticated = false;

    // Try to read JWT from Authorization header
    const authHeader = request.headers.authorization;
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // Fallback to cookie if no header token
    if (!token && request.cookies?.cap5_token) {
      token = request.cookies.cap5_token;
    }

    // Try to verify token
    if (token) {
      try {
        const decoded = verifyToken(token);
        request.userId = decoded.sub;
        request.authenticated = true;
      } catch {
        // Token invalid or expired, just leave as unauthenticated
        request.userId = null;
        request.authenticated = false;
      }
    }
  });
};

export default fp(authPlugin, { name: 'auth' });
