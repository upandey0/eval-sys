const express = require('express');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Logging utility
const log = (message, level = 'INFO') => {
  const timestamp = new Date().toISOString();
  const emoji = {
    'INFO': '📋',
    'SUCCESS': '✅',
    'ERROR': '❌',
    'WARN': '⚠️',
    'SEARCH': '🔍',
    'CONNECT': '🔗',
    'PROCESS': '🔄',
    'SAVE': '💾'
  };
  console.log(`${emoji[level] || '📋'} [${timestamp}] ${message}`);
};

// MongoDB connection
async function connectToMongoDB() {
  log('Attempting to connect to MongoDB...', 'CONNECT');
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    await client.db().admin().ping();
    log('Successfully connected to MongoDB', 'SUCCESS');
    return client;
  } catch (error) {
    log(`Failed to connect to MongoDB: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Parse date input
function parseDateInput(dateStr) {
  log(`Parsing date input: '${dateStr}'`);
  
  let parsedDate;
  try {
    // Try YYYY-MM-DD format first
    parsedDate = new Date(dateStr + 'T00:00:00.000Z');
    if (isNaN(parsedDate.getTime())) {
      throw new Error('Invalid date format');
    }
    log('Successfully parsed date using YYYY-MM-DD format', 'SUCCESS');
  } catch (error) {
    log(`Failed to parse date '${dateStr}': ${error.message}`, 'ERROR');
    throw new Error(`Invalid date format. Please use YYYY-MM-DD format.`);
  }
  
  const startDate = new Date(parsedDate);
  startDate.setUTCHours(0, 0, 0, 0);
  
  const endDate = new Date(parsedDate);
  endDate.setUTCHours(23, 59, 59, 999);
  
  log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  return { startDate, endDate };
}

// Get chat sessions by date
async function getChatSessionsByDate(client, targetDate) {
  log(`Searching for chat sessions on date: ${targetDate}`, 'SEARCH');
  
  const db = client.db('fraiday-backend');
  const collection = db.collection('chat_sessions');
  log("Using database: 'fraiday-backend', collection: 'chat_sessions'");
  
  const { startDate, endDate } = parseDateInput(targetDate);
  
  const dateFilter = {
    $or: [
      { createdAt: { $gte: startDate, $lte: endDate } },
      { created_at: { $gte: startDate, $lte: endDate } },
      { timestamp: { $gte: startDate, $lte: endDate } },
      { date: { $gte: startDate, $lte: endDate } }
    ]
  };
  
  log(`Using filter: ${JSON.stringify(dateFilter)}`);
  
  try {
    const sessions = await collection.find(dateFilter).toArray();
    log(`Found ${sessions.length} sessions matching the date filter`, 'SUCCESS');
    
    if (sessions.length > 0) {
      const sampleIds = sessions.slice(0, 3).map(s => s._id.toString());
      log(`Sample session IDs: ${sampleIds.join(', ')}`);
    }
    
    // Select 4 sessions if >= 4, otherwise return all
    if (sessions.length >= 4) {
      const selectedSessions = [];
      const usedIndices = new Set();
      
      while (selectedSessions.length < 4 && usedIndices.size < sessions.length) {
        const randomIndex = Math.floor(Math.random() * sessions.length);
        if (!usedIndices.has(randomIndex)) {
          usedIndices.add(randomIndex);
          selectedSessions.push(sessions[randomIndex]);
        }
      }
      
      log(`Randomly selected 4 sessions from ${sessions.length} total sessions`);
      const selectedIds = selectedSessions.map(s => s._id.toString());
      log(`Selected session IDs: ${selectedIds.join(', ')}`);
      return selectedSessions;
    } else {
      log(`Returning all ${sessions.length} sessions (less than 4 found)`);
      return sessions;
    }
  } catch (error) {
    log(`Error querying database: ${error.message}`, 'ERROR');
    return [];
  }
}

// Invoke workflow
async function invokeWorkflow(sessionId) {
  log(`Invoking workflow for session ID: ${sessionId}`, 'PROCESS');
  
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json'
  };
  
  const payload = {
    id: process.env.WORKFLOW_ID,
    input_args: {
      human_msg: sessionId,
      session_id: '6791ec1b18070f42a7700e4e',
      user_id: 'abcd',
      meta_data: 'abcd',
      client_id: 'abcd'
    }
  };
  
  log(`Sending request to: ${process.env.WORKFLOW_INVOKE_URL}`);
  log(`Payload: ${JSON.stringify(payload)}`);
  
  try {
    const response = await axios.post(
      process.env.WORKFLOW_INVOKE_URL,
      payload,
      {
        auth: {
          username: process.env.WORKFLOW_AUTH_USERNAME,
          password: process.env.WORKFLOW_AUTH_PASSWORD
        },
        headers,
        timeout: 50000
      }
    );
    
    log(`Response status code: ${response.status}`);
    
    if (response.status === 200) {
      log('Successful workflow response received', 'SUCCESS');
      const result = response.data;
      const keys = typeof result === 'object' ? Object.keys(result) : 'Not an object';
      log(`Response keys: ${Array.isArray(keys) ? keys.join(', ') : keys}`);
      return result;
    } else {
      log(`HTTP error ${response.status}`, 'ERROR');
      log(`Response text: ${JSON.stringify(response.data)}`);
      return { error: `HTTP ${response.status}` };
    }
  } catch (error) {
    log(`Request failed with exception: ${error.message}`, 'ERROR');
    return { error: `Request exception: ${error.message}` };
  }
}

// Invoke agent with workflow results
async function invokeAgentWithWorkflowResults(workflowResults) {
  log('Invoking agent with workflow results...', 'PROCESS');
  
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json'
  };
  
  // Convert workflow results to string for the agent
  const resultsString = typeof workflowResults === 'object' 
    ? JSON.stringify(workflowResults) 
    : String(workflowResults);
  
  const payload = {
    agent_id: process.env.AGENT_ID,
    input_args: {
      results: resultsString
    }
  };
  
  log(`Sending request to: ${process.env.AGENT_INVOKE_URL}`);
  log(`Agent payload: ${JSON.stringify(payload)}`);
  
  try {
    const response = await axios.post(
      process.env.AGENT_INVOKE_URL,
      payload,
      {
        auth: {
          username: process.env.AGENT_AUTH_USERNAME,
          password: process.env.AGENT_AUTH_PASSWORD
        },
        headers,
        timeout: 50000
      }
    );
    
    log(`Agent response status code: ${response.status}`);
    
    if (response.status === 200) {
      log('Successful agent response received', 'SUCCESS');
      const result = response.data;
      const keys = typeof result === 'object' ? Object.keys(result) : 'Not an object';
      log(`Agent response keys: ${Array.isArray(keys) ? keys.join(', ') : keys}`);
      return result;
    } else {
      log(`Agent HTTP error ${response.status}`, 'ERROR');
      log(`Agent response text: ${JSON.stringify(response.data)}`);
      return { 
        error: `Agent HTTP ${response.status}`, 
        response_text: response.data 
      };
    }
  } catch (error) {
    log(`Agent request failed with exception: ${error.message}`, 'ERROR');
    return { error: `Agent request exception: ${error.message}` };
  }
}

// Save results to JSON file
async function saveResultsToJson(results, filename = null) {
  if (!filename) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
    filename = `workflow_agent_results_${timestamp}.json`;
  }
  
  log(`Saving results to: ${filename}`, 'SAVE');
  
  try {
    const resultsDir = path.join(__dirname, 'results');
    await fs.mkdir(resultsDir, { recursive: true });
    
    const filepath = path.join(resultsDir, filename);
    await fs.writeFile(filepath, JSON.stringify(results, null, 2), 'utf8');
    log(`Results successfully saved to ${filepath}`, 'SUCCESS');
    return filepath;
  } catch (error) {
    log(`Failed to save results: ${error.message}`, 'ERROR');
    return null;
  }
}

// Main processing function
async function getSessionsAndProcessWithAgent(targetDate, outputFilename = null) {
  log(`Starting enhanced workflow + agent processing for date: ${targetDate}`, 'PROCESS');
  log('='.repeat(60));
  
  let client;
  try {
    // Connect to MongoDB
    client = await connectToMongoDB();
    
    // Get sessions
    const sessions = await getChatSessionsByDate(client, targetDate);
    
    if (!sessions || sessions.length === 0) {
      log('No sessions found for the specified date', 'WARN');
      return {
        success: false,
        message: 'No sessions found for the specified date',
        data: null
      };
    }
    
    const sessionIds = sessions.map(session => session._id.toString());
    log(`Processing ${sessionIds.length} session IDs through workflow + agent`);
    log(`Session IDs to process: ${sessionIds.join(', ')}`);
    
    // Structure to hold all results
    const completeResults = {
      metadata: {
        processed_date: targetDate,
        processing_timestamp: new Date().toISOString(),
        total_sessions: sessionIds.length,
        workflow_id: process.env.WORKFLOW_ID,
        agent_id: process.env.AGENT_ID
      },
      session_results: []
    };
    
    // Process each session
    for (let i = 0; i < sessionIds.length; i++) {
      const sessionId = sessionIds[i];
      log('='.repeat(40));
      log(`Processing session ${i + 1}/${sessionIds.length}: ${sessionId}`, 'PROCESS');
      
      const sessionResult = {
        session_id: sessionId,
        processing_order: i + 1,
        workflow_result: null,
        agent_result: null,
        status: 'pending',
        errors: []
      };
      
      try {
        // Step 1: Invoke workflow
        log(`Step 1: Invoking workflow for session ${sessionId}`);
        const workflowResult = await invokeWorkflow(sessionId);
        sessionResult.workflow_result = workflowResult;
        
        // Check if workflow was successful
        if (workflowResult.status === 'success' && workflowResult.result) {
          const workflowData = workflowResult.result;
          log('Workflow completed successfully', 'SUCCESS');
          
          // Step 2: Invoke agent with workflow results
          log('Step 2: Invoking agent with workflow results');
          const agentResult = await invokeAgentWithWorkflowResults(workflowData);
          sessionResult.agent_result = agentResult;
          
          if (!agentResult.error) {
            sessionResult.status = 'completed';
            log('Agent invocation completed successfully', 'SUCCESS');
          } else {
            sessionResult.status = 'agent_error';
            sessionResult.errors.push(`Agent error: ${agentResult.error}`);
            log('Agent invocation failed', 'ERROR');
          }
        } else {
          sessionResult.status = 'workflow_error';
          const errorMsg = `Workflow failed for session ${sessionId}`;
          sessionResult.errors.push(errorMsg);
          log(errorMsg, 'ERROR');
          log(`Workflow result: ${JSON.stringify(workflowResult)}`);
        }
      } catch (error) {
        sessionResult.status = 'error';
        sessionResult.errors.push(`Processing error: ${error.message}`);
        log(`Error processing session ${sessionId}: ${error.message}`, 'ERROR');
      }
      
      completeResults.session_results.push(sessionResult);
      log(`Session ${sessionId} final status: ${sessionResult.status}`);
    }
    
    // Calculate summary statistics
    const successfulCount = completeResults.session_results.filter(r => r.status === 'completed').length;
    const workflowErrorCount = completeResults.session_results.filter(r => r.status === 'workflow_error').length;
    const agentErrorCount = completeResults.session_results.filter(r => r.status === 'agent_error').length;
    const otherErrorCount = completeResults.session_results.filter(r => r.status === 'error').length;
    
    completeResults.metadata.summary = {
      successful_sessions: successfulCount,
      workflow_errors: workflowErrorCount,
      agent_errors: agentErrorCount,
      other_errors: otherErrorCount,
      success_rate: `${((successfulCount / sessionIds.length) * 100).toFixed(1)}%`
    };
    
    log('='.repeat(60));
    log('Enhanced workflow + agent processing complete!', 'SUCCESS');
    log(`Results: ${successfulCount} successful, ${workflowErrorCount} workflow errors, ${agentErrorCount} agent errors, ${otherErrorCount} other errors`);
    log(`Success rate: ${completeResults.metadata.summary.success_rate}`);
    
    // Save results to JSON file
    const savedFilename = await saveResultsToJson(completeResults, outputFilename);
    
    if (savedFilename) {
      log(`All results saved to: ${savedFilename}`, 'SAVE');
    }
    
    return {
      success: true,
      message: 'Processing completed successfully',
      data: completeResults,
      saved_file: savedFilename
    };
    
  } catch (error) {
    log(`Processing failed: ${error.message}`, 'ERROR');
    return {
      success: false,
      message: `Processing failed: ${error.message}`,
      data: null
    };
  } finally {
    if (client) {
      await client.close();
      log('MongoDB connection closed');
    }
  }
}

// API Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Chat Session Processor API',
    version: '1.0.0',
    endpoints: {
      'POST /process': 'Process chat sessions for a given date',
      'GET /health': 'Health check endpoint'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.post('/process', async (req, res) => {
  try {
    const { date, output_filename } = req.body;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date parameter is required',
        example: { date: '2025-03-20' }
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use YYYY-MM-DD format',
        example: { date: '2025-03-20' }
      });
    }
    
    log(`Processing request for date: ${date}`, 'PROCESS');
    
    const result = await getSessionsAndProcessWithAgent(date, output_filename);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
    
  } catch (error) {
    log(`API error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  log(`Unhandled error: ${err.message}`, 'ERROR');
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    available_endpoints: ['GET /', 'GET /health', 'POST /process']
  });
});

// Start server
app.listen(PORT, () => {
  log(`Server running on port ${PORT}`, 'SUCCESS');
  log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  log(`API endpoints available at http://localhost:${PORT}`);
});

module.exports = app;
