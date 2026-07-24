const express = require('express');
const Redis = require('ioredis');

const app = express();
const port = 3000;

// Connect to Redis. Assumes Redis is running on localhost:6379
// In a production environment, this would be configured via environment variables.
const redis = new Redis();

app.use(express.json());

// Helper to construct Redis key for agent state
const getAgentKey = (agentId, key) => `agent:${agentId}:${key}`;
const getAgentPrefix = (agentId) => `agent:${agentId}:*`;

// Middleware for basic logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * POST /state
 * Set a specific state key-value for an agent.
 * Body: { agentId: string, key: string, value: any }
 */
app.post('/state', async (req, res) => {
  const { agentId, key, value } = req.body;

  if (!agentId || !key || value === undefined) {
    return res.status(400).send('Agent ID, key, and value are required.');
  }

  try {
    const redisKey = getAgentKey(agentId, key);
    await redis.set(redisKey, JSON.stringify(value)); // Store as JSON string
    res.status(200).send({ message: 'State set successfully', agentId, key });
  } catch (error) {
    console.error('Error setting agent state:', error);
    res.status(500).send('Internal server error.');
  }
});

/**
 * GET /state/:agentId/:key
 * Retrieve a specific state key's value for an agent.
 */
app.get('/state/:agentId/:key', async (req, res) => {
  const { agentId, key } = req.params;

  try {
    const redisKey = getAgentKey(agentId, key);
    const storedValue = await redis.get(redisKey);

    if (storedValue === null) {
      return res.status(404).send('State key not found for this agent.');
    }

    res.status(200).json(JSON.parse(storedValue));
  } catch (error) {
    console.error('Error getting agent state:', error);
    res.status(500).send('Internal server error.');
  }
});

/**
 * GET /state/:agentId
 * Retrieve all state for a given agent.
 */
app.get('/state/:agentId', async (req, res) => {
  const { agentId } = req.params;

  try {
    const keys = await redis.keys(getAgentPrefix(agentId));
    if (keys.length === 0) {
      return res.status(404).send('No state found for this agent.');
    }

    const pipeline = redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();

    const agentState = {};
    for (let i = 0; i < keys.length; i++) {
      const originalKey = keys[i].split(':').slice(2).join(':'); // Extract original key part
      if (results[i][1] !== null) { // Check if value exists
        agentState[originalKey] = JSON.parse(results[i][1]);
      }
    }
    res.status(200).json(agentState);
  } catch (error) {
    console.error('Error getting all agent state:', error);
    res.status(500).send('Internal server error.');
  }
});

/**
 * DELETE /state/:agentId/:key
 * Delete a specific state key for an agent.
 */
app.delete('/state/:agentId/:key', async (req, res) => {
  const { agentId, key } = req.params;

  try {
    const redisKey = getAgentKey(agentId, key);
    const deletedCount = await redis.del(redisKey);

    if (deletedCount === 0) {
      return res.status(404).send('State key not found for this agent.');
    }

    res.status(200).send({ message: 'State deleted successfully', agentId, key });
  } catch (error) {
    console.error('Error deleting agent state:', error);
    res.status(500).send('Internal server error.');
  }
});

/**
 * DELETE /state/:agentId
 * Delete all state for a given agent.
 */
app.delete('/state/:agentId', async (req, res) => {
  const { agentId } = req.params;

  try {
    const keysToDelete = await redis.keys(getAgentPrefix(agentId));
    if (keysToDelete.length === 0) {
      return res.status(404).send('No state found for this agent to delete.');
    }

    const deletedCount = await redis.del(...keysToDelete);
    res.status(200).send({ message: `Deleted ${deletedCount} state keys for agent ${agentId}` });
  } catch (error) {
    console.error('Error deleting all agent state:', error);
    res.status(500).send('Internal server error.');
  }
});


app.listen(port, () => {
  console.log(`Agent memory service listening at http://localhost:${port}`);
  console.log('Redis connection status:', redis.status);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await redis.quit();
  console.log('Redis client disconnected.');
  process.exit(0);
});
