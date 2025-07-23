const express = require('express');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
let mongoClient = null;

async function connectToMongoDB() {
    try {
        if (!mongoClient) {
            mongoClient = new MongoClient(process.env.MONGODB_URI);
            await mongoClient.connect();
            console.log('Connected to MongoDB successfully!');
        }
        return mongoClient;
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw error;
    }
}

// Get chat sessions from MongoDB based on date range
async function getChatSessions(fromDate, toDate) {
    try {
        const client = await connectToMongoDB();
        const db = client.db(process.env.MONGODB_DATABASE || 'fraiday-backend');
        const collection = db.collection('chat_sessions');
        
        // Convert date strings to Date objects for MongoDB query
        const startDate = new Date(fromDate);
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999); // Include the entire end date
        
        console.log(`🔍 Querying sessions from ${startDate} to ${endDate}`);
        
        // Query sessions within date range
        const query = {
            $or: [
                { createdAt: { $gte: startDate, $lte: endDate } },
                { timestamp: { $gte: startDate, $lte: endDate } },
                { created_at: { $gte: startDate, $lte: endDate } }
            ]
        };
        
        console.log('📋 MongoDB Query:', JSON.stringify(query, null, 2));
        
        const sessions = await collection.find(query).toArray();
        console.log(`📊 Found ${sessions.length} sessions in date range`);
        
        // Log first session structure for debugging
        if (sessions.length > 0) {
            console.log('🔍 First session structure:');
            console.log('Session keys:', Object.keys(sessions[0]));
            console.log('Session sample:', JSON.stringify(sessions[0], null, 2));
        }
        
        return sessions;
    } catch (error) {
        console.error('❌ Error retrieving chat sessions:', error);
        throw error;
    }
}

// Call workflow API for session analysis
async function analyzeSession(sessionId) {
    const payload = {
        id: process.env.WORKFLOW_ID,
        input_args: {
            user_id: "dashboard_user",
            human_msg: sessionId,
            session_id: sessionId,
            client_id: "dashboard_client",
            metadata: "{}"
        }
    };
    
    console.log('📤 Sending to workflow API:');
    console.log('- URL:', process.env.WORKFLOW_API_URL);
    console.log('- Workflow ID:', process.env.WORKFLOW_ID);
    console.log('- Session ID:', sessionId);
    console.log('- Full payload:', JSON.stringify(payload, null, 2));
    
    const authString = Buffer.from(`${process.env.API_USERNAME}:${process.env.API_PASSWORD}`).toString('base64');
    
    try {
        const requestStart = Date.now();
        console.log('⏱️ Making API request...');
        
        const response = await axios.post(process.env.WORKFLOW_API_URL, payload, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            timeout: 300000 // 300 second timeout per request
        });
        
        const requestEnd = Date.now();
        const requestDuration = requestEnd - requestStart;
        
        console.log('✅ API Response received:');
        console.log('- Status:', response.status);
        console.log('- Status Text:', response.statusText);
        console.log('- Request Duration:', `${requestDuration}ms`);
        console.log('- Response Headers:', JSON.stringify(response.headers, null, 2));
        // console.log('- Full Response Data:', JSON.stringify(response.data, null, 2));
        
        if (response.data && response.data.result) {
            console.log('🎯 Extracted Results:');
            console.log('- Results type:', typeof response.data.result);
            console.log('- Results content:', JSON.stringify(response.data.result, null, 2));
        } else {
            console.log('⚠️ No results field found in response.data');
        }
        
        return response.data.result;
    } catch (error) {
        console.error(`❌ Error analyzing session ${sessionId}:`);
        console.error('- Error message:', error.message);
        console.error('- Error code:', error.code);
        
        if (error.response) {
            console.error('- Response status:', error.response.status);
            console.error('- Response headers:', JSON.stringify(error.response.headers, null, 2));
            console.error('- Response data:', JSON.stringify(error.response.data, null, 2));
        }
        
        if (error.request) {
            console.error('- Request details:', error.request);
        }
        
        throw error;
    }
}

// Function to normalize analysis results for case consistency
function normalizeAnalysisResult(result) {
    if (!result || typeof result !== 'object') {
        return result;
    }
    
    const normalized = { ...result };
    
    // Normalize accuracy_level to lowercase
    if (normalized.accuracy_level && typeof normalized.accuracy_level === 'string') {
        normalized.accuracy_level = normalized.accuracy_level.toLowerCase();
    }
    
    // Normalize other boolean/status fields that might have case issues
    if (normalized.is_chat_completed && typeof normalized.is_chat_completed === 'string') {
        normalized.is_chat_completed = normalized.is_chat_completed.toLowerCase();
    }
    
    if (normalized.overall_latency_classification && typeof normalized.overall_latency_classification === 'string') {
        normalized.overall_latency_classification = normalized.overall_latency_classification.toLowerCase();
    }
    
    // Normalize nested object values
    if (normalized.human_escalation?.is_escalated) {
        normalized.human_escalation.is_escalated = normalized.human_escalation.is_escalated.toLowerCase();
    }
    
    if (normalized.issue_status?.status) {
        normalized.issue_status.status = normalized.issue_status.status.toLowerCase();
    }
    
    if (normalized.escalation_necessity?.was_escalation_necessary) {
        normalized.escalation_necessity.was_escalation_necessary = normalized.escalation_necessity.was_escalation_necessary.toLowerCase();
    }
    
    if (normalized.bot_tone?.tone) {
        normalized.bot_tone.tone = normalized.bot_tone.tone.toLowerCase();
    }
    
    if (normalized.user_sentiment?.sentiment) {
        normalized.user_sentiment.sentiment = normalized.user_sentiment.sentiment.toLowerCase();
    }
    
    if (normalized.response_quality) {
        const quality = normalized.response_quality;
        if (quality.is_clear && typeof quality.is_clear === 'string') {
            quality.is_clear = quality.is_clear.toLowerCase();
        }
        if (quality.is_concise && typeof quality.is_concise === 'string') {
            quality.is_concise = quality.is_concise.toLowerCase();
        }
        if (quality.is_easy_to_understand && typeof quality.is_easy_to_understand === 'string') {
            quality.is_easy_to_understand = quality.is_easy_to_understand.toLowerCase();
        }
        if (quality.is_relevant && typeof quality.is_relevant === 'string') {
            quality.is_relevant = quality.is_relevant.toLowerCase();
        }
        if (quality.overall_quality_score && typeof quality.overall_quality_score === 'string') {
            quality.overall_quality_score = quality.overall_quality_score.toLowerCase();
        }
    }
    
    if (normalized.conversation_quality?.quality) {
        normalized.conversation_quality.quality = normalized.conversation_quality.quality.toLowerCase();
    }
    
    return normalized;
}

// New scoring function based on the provided formula
function calculateSessionScore(analysis) {
    if (!analysis) {
        console.log('⚠️ No analysis data provided for scoring');
        return 0;
    }
    
    let totalScore = 0;
    const scoreBreakdown = {};
    
    console.log('📊 Calculating score with new formula...');
    
    // 1. Issue Resolution Success (25%)
    let issueResolutionScore = 0;
    if (analysis.issue_status?.status) {
        issueResolutionScore = analysis.issue_status.status.toLowerCase() === 'resolved' ? 100 : 0;
        console.log(`- Issue Resolution: ${analysis.issue_status.status} → ${issueResolutionScore} points`);
    }
    scoreBreakdown.issueResolution = issueResolutionScore * 0.25;
    totalScore += scoreBreakdown.issueResolution;
    
    // 2. Human Escalation Impact (20%)
    let escalationScore = 0;
    if (analysis.human_escalation?.is_escalated) {
        escalationScore = analysis.human_escalation.is_escalated.toLowerCase() === 'no' ? 100 : 0;
        console.log(`- Human Escalation: ${analysis.human_escalation.is_escalated} → ${escalationScore} points`);
    }
    scoreBreakdown.escalationAvoidance = escalationScore * 0.20;
    totalScore += scoreBreakdown.escalationAvoidance;
    
    // 3. User Experience Quality (15%)
    let userExperienceScore = 0;
    if (analysis.user_experience?.experience_level) {
        const level = analysis.user_experience.experience_level;
        switch(level) {
            case 5: userExperienceScore = 100; break;
            case 4: userExperienceScore = 80; break;
            case 3: userExperienceScore = 60; break;
            case 2: userExperienceScore = 40; break;
            case 1: userExperienceScore = 20; break;
            default: userExperienceScore = 0;
        }
        console.log(`- User Experience Level: ${level} → ${userExperienceScore} points`);
    }
    scoreBreakdown.userExperience = userExperienceScore * 0.15;
    totalScore += scoreBreakdown.userExperience;
    
    // 4. Conversation Completion (10%)
    let completionScore = 0;
    if (analysis.is_chat_completed) {
        completionScore = analysis.is_chat_completed.toLowerCase() === 'yes' ? 100 : 0;
        console.log(`- Chat Completion: ${analysis.is_chat_completed} → ${completionScore} points`);
    }
    scoreBreakdown.chatCompletion = completionScore * 0.10;
    totalScore += scoreBreakdown.chatCompletion;
    
    // 5. Overall Response Quality (8%)
    let responseQualityScore = 0;
    if (analysis.response_quality?.overall_quality_score) {
        const quality = analysis.response_quality.overall_quality_score.toLowerCase();
        switch(quality) {
            case 'excellent': responseQualityScore = 100; break;
            case 'good': responseQualityScore = 75; break;
            case 'fair': responseQualityScore = 50; break;
            case 'poor': responseQualityScore = 25; break;
            default: responseQualityScore = 0;
        }
        console.log(`- Response Quality: ${quality} → ${responseQualityScore} points`);
    }
    scoreBreakdown.responseQuality = responseQualityScore * 0.08;
    totalScore += scoreBreakdown.responseQuality;
    
    // 6. Response Accuracy (7%)
    let accuracyScore = 0;
    if (analysis.accuracy_level) {
        const accuracy = analysis.accuracy_level.toLowerCase();
        switch(accuracy) {
            case 'correct': accuracyScore = 100; break;
            case 'partially correct': accuracyScore = 50; break;
            case 'wrong': accuracyScore = 0; break;
            default: accuracyScore = 0;
        }
        console.log(`- Accuracy: ${accuracy} → ${accuracyScore} points`);
    }
    scoreBreakdown.accuracy = accuracyScore * 0.07;
    totalScore += scoreBreakdown.accuracy;
    
    // 7. Response Components (5% total - 1.25% each)
    let componentScore = 0;
    if (analysis.response_quality) {
        const components = ['is_clear', 'is_concise', 'is_easy_to_understand', 'is_relevant'];
        let componentPoints = 0;
        components.forEach(component => {
            if (analysis.response_quality[component]) {
                const value = analysis.response_quality[component].toLowerCase() === 'yes' ? 100 : 0;
                componentPoints += value;
                console.log(`- ${component}: ${analysis.response_quality[component]} → ${value} points`);
            }
        });
        componentScore = componentPoints / 4; // Average of 4 components
    }
    scoreBreakdown.responseComponents = componentScore * 0.05;
    totalScore += scoreBreakdown.responseComponents;
    
    // 8. User Sentiment (5%)
    let sentimentScore = 0;
    if (analysis.user_sentiment?.sentiment) {
        const sentiment = analysis.user_sentiment.sentiment.toLowerCase();
        switch(sentiment) {
            case 'positive': sentimentScore = 100; break;
            case 'neutral': sentimentScore = 70; break;
            case 'negative': sentimentScore = 30; break;
            case 'frustrated': sentimentScore = 0; break;
            default: sentimentScore = 70; // Default to neutral
        }
        console.log(`- User Sentiment: ${sentiment} → ${sentimentScore} points`);
    }
    scoreBreakdown.userSentiment = sentimentScore * 0.05;
    totalScore += scoreBreakdown.userSentiment;
    
    // 9. User Effort Required (3%) - Inverted scoring
    let effortScore = 0;
    if (analysis.user_effort?.effort_level) {
        const level = analysis.user_effort.effort_level;
        switch(level) {
            case 1: effortScore = 100; break;
            case 2: effortScore = 80; break;
            case 3: effortScore = 60; break;
            case 4: effortScore = 40; break;
            case 5: effortScore = 20; break;
            default: effortScore = 0;
        }
        console.log(`- User Effort Level: ${level} → ${effortScore} points`);
    }
    scoreBreakdown.userEffort = effortScore * 0.03;
    totalScore += scoreBreakdown.userEffort;
    
    // 10. Bot Communication Tone (2%)
    let toneScore = 0;
    if (analysis.bot_tone?.tone) {
        const tone = analysis.bot_tone.tone.toLowerCase();
        switch(tone) {
            case 'professional': toneScore = 100; break;
            case 'friendly': toneScore = 95; break;
            case 'neutral': toneScore = 70; break;
            case 'inappropriate': toneScore = 0; break;
            default: toneScore = 70; // Default to neutral
        }
        console.log(`- Bot Tone: ${tone} → ${toneScore} points`);
    }
    scoreBreakdown.botTone = toneScore * 0.02;
    totalScore += scoreBreakdown.botTone;
    
    // Bonus/Penalty Factors
    let penalties = 0;
    
    // Escalation Necessity Penalty (-10 points)
    if (analysis.escalation_necessity?.was_escalation_necessary === 'no' && 
        analysis.human_escalation?.is_escalated === 'yes') {
        penalties -= 10;
        console.log('- Escalation Necessity Penalty: -10 points');
    }
    
    // Performance Penalty (up to -5 points)
    if (analysis.overall_latency_classification) {
        const latency = analysis.overall_latency_classification.toLowerCase();
        switch(latency) {
            case 'good': break; // No penalty
            case 'average': penalties -= 2; break;
            case 'bad': penalties -= 5; break;
        }
        console.log(`- Latency Penalty: ${latency} → ${penalties < 0 ? penalties : 0} points`);
    }
    
    totalScore += penalties;
    scoreBreakdown.penalties = penalties;
    
    console.log(`📊 Final Score Breakdown:`, scoreBreakdown);
    console.log(`📊 Total Score: ${totalScore.toFixed(2)}`);
    
    return {
        totalScore: Math.max(0, Math.round(totalScore * 100) / 100), // Ensure non-negative, round to 2 decimals
        breakdown: scoreBreakdown
    };
}

// Function to calculate aggregate statistics
function calculateAggregateStats(analysisResults) {
    if (!analysisResults || analysisResults.length === 0) {
        return {
            average_chat_completion_rate: { "yes": 0, "no": 0 },
            average_user_sentiment_distribution: {},
            average_bot_tone_distribution: {},
            average_anydesk_required: { "true": 0, "false": 0 },
            average_user_experience_level: 0,
            average_user_effort_level: 0,
            average_response_accuracy: {},
            average_issue_resolution_rate: { "resolved": 0, "unresolved": 0 },
            average_human_escalation_rate: { "yes": 0, "no": 0 }
        };
    }
    
    const totalSessions = analysisResults.length;
    const stats = {
        chat_completion: { "yes": 0, "no": 0 },
        user_sentiment: {},
        bot_tone: {},
        anydesk_required: { "true": 0, "false": 0 },
        user_experience_levels: [],
        user_effort_levels: [],
        accuracy_levels: {},
        issue_resolution: { "resolved": 0, "unresolved": 0 },
        human_escalation: { "yes": 0, "no": 0 }
    };
    
    analysisResults.forEach(result => {
        const analysis = result.analysis;
        
        // Chat completion
        if (analysis.is_chat_completed) {
            const completion = analysis.is_chat_completed.toLowerCase();
            stats.chat_completion[completion] = (stats.chat_completion[completion] || 0) + 1;
        }
        
        // User sentiment
        if (analysis.user_sentiment?.sentiment) {
            const sentiment = analysis.user_sentiment.sentiment.toLowerCase();
            stats.user_sentiment[sentiment] = (stats.user_sentiment[sentiment] || 0) + 1;
        }
        
        // Bot tone
        if (analysis.bot_tone?.tone) {
            const tone = analysis.bot_tone.tone.toLowerCase();
            stats.bot_tone[tone] = (stats.bot_tone[tone] || 0) + 1;
        }
        
        // AnyDesk required
        if (analysis.conversation_quality?.is_anydesk_required !== undefined) {
            const anydesk = analysis.conversation_quality.is_anydesk_required.toString();
            stats.anydesk_required[anydesk] = (stats.anydesk_required[anydesk] || 0) + 1;
        }
        
        // User experience level
        if (analysis.user_experience?.experience_level) {
            stats.user_experience_levels.push(analysis.user_experience.experience_level);
        }
        
        // User effort level
        if (analysis.user_effort?.effort_level) {
            stats.user_effort_levels.push(analysis.user_effort.effort_level);
        }
        
        // Accuracy levels
        if (analysis.accuracy_level) {
            const accuracy = analysis.accuracy_level.toLowerCase();
            stats.accuracy_levels[accuracy] = (stats.accuracy_levels[accuracy] || 0) + 1;
        }
        
        // Issue resolution
        if (analysis.issue_status?.status) {
            const status = analysis.issue_status.status.toLowerCase();
            stats.issue_resolution[status] = (stats.issue_resolution[status] || 0) + 1;
        }
        
        // Human escalation
        if (analysis.human_escalation?.is_escalated) {
            const escalated = analysis.human_escalation.is_escalated.toLowerCase();
            stats.human_escalation[escalated] = (stats.human_escalation[escalated] || 0) + 1;
        }
    });
    
    // Convert counts to percentages and calculate averages
    const convertToPercentages = (obj) => {
        const result = {};
        Object.keys(obj).forEach(key => {
            result[key] = Math.round((obj[key] / totalSessions) * 100);
        });
        return result;
    };
    
    return {
        average_chat_completion_rate: convertToPercentages(stats.chat_completion),
        average_user_sentiment_distribution: convertToPercentages(stats.user_sentiment),
        average_bot_tone_distribution: convertToPercentages(stats.bot_tone),
        average_anydesk_required: convertToPercentages(stats.anydesk_required),
        average_user_experience_level: stats.user_experience_levels.length > 0 
            ? Math.round((stats.user_experience_levels.reduce((a, b) => a + b, 0) / stats.user_experience_levels.length) * 100) / 100 
            : 0,
        average_user_effort_level: stats.user_effort_levels.length > 0 
            ? Math.round((stats.user_effort_levels.reduce((a, b) => a + b, 0) / stats.user_effort_levels.length) * 100) / 100 
            : 0,
        average_response_accuracy: convertToPercentages(stats.accuracy_levels),
        average_issue_resolution_rate: convertToPercentages(stats.issue_resolution),
        average_human_escalation_rate: convertToPercentages(stats.human_escalation)
    };
}

// Main analysis endpoint - Updated to process ALL sessions
app.post('/api/analyze-conversations', async (req, res) => {
    const { fromDate, toDate } = req.body;
    
    console.log('🚀 Starting conversation analysis...');
    console.log('- From date:', fromDate);
    console.log('- To date:', toDate);
    
    if (!fromDate || !toDate) {
        console.log('❌ Missing date parameters');
        return res.status(400).json({ 
            error: 'Both fromDate and toDate are required' 
        });
    }
    
    try {
        // Step 1: Get chat sessions from MongoDB
        console.log('📋 Step 1: Fetching chat sessions from MongoDB...');
        const sessions = await getChatSessions(fromDate, toDate);
        
        if (sessions.length === 0) {
            console.log('ℹ️ No sessions found for date range');
            const response = {
                success: true,
                message: 'No sessions found for the specified date range',
                data: {
                    totalSessions: 0,
                    processedSessions: 0,
                    failedSessions: 0,
                    analysisResults: [],
                    executionTime: 0,
                    overallScore: 0,
                    aggregateStats: calculateAggregateStats([])
                }
            };
            console.log('📤 Sending response:', JSON.stringify(response, null, 2));
            return res.json(response);
        }
        
        const startTime = Date.now();
        console.log(`🔄 Processing ALL ${sessions.length} sessions...`);
        
        const analysisResults = [];
        const failedSessions = [];
        let processedCount = 0;
        
        // Process all sessions
        for (let i = 0; i < sessions.length; i++) {
            const session = sessions[i];
            const sessionId = session._id?.toString() || session.id || session.session_id;
            
            if (!sessionId) {
                console.log(`❌ No valid session ID found for session ${i}`);
                failedSessions.push({ index: i, error: 'No valid session ID' });
                continue;
            }
            
            console.log(`🔄 Processing session ${i + 1}/${sessions.length}: ${sessionId}`);
            
            try {
                const rawResult = await analyzeSession(sessionId);
                const normalizedResult = normalizeAnalysisResult(rawResult);
                
                const sessionScore = calculateSessionScore(normalizedResult);
                
                analysisResults.push({
                    sessionId: sessionId,
                    analysis: normalizedResult,
                    score: sessionScore,
                    timestamp: new Date()
                });
                
                processedCount++;
                console.log(`✅ Session ${sessionId} processed successfully (Score: ${sessionScore.totalScore})`);
                
            } catch (error) {
                console.error(`❌ Failed to analyze session ${sessionId}:`, error.message);
                failedSessions.push({ 
                    sessionId, 
                    error: error.message,
                    index: i 
                });
            }
            
            // Add a small delay to prevent overwhelming the API
            if (i < sessions.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
            }
        }
        
        const endTime = Date.now();
        const executionTime = Math.round((endTime - startTime) / 1000);
        
        // Calculate overall score from processed sessions
        const totalScore = analysisResults.reduce((sum, result) => sum + result.score.totalScore, 0);
        const overallScore = analysisResults.length > 0 ? totalScore / analysisResults.length : 0;
        
        // Calculate aggregate statistics
        const aggregateStats = calculateAggregateStats(analysisResults);
        
        console.log('✅ Analysis completed');
        console.log(`- Total sessions: ${sessions.length}`);
        console.log(`- Processed: ${processedCount}`);
        console.log(`- Failed: ${failedSessions.length}`);
        console.log(`- Execution time: ${executionTime}s`);
        console.log(`- Overall score: ${overallScore.toFixed(2)}`);
        
        const response = {
            success: true,
            message: `Analysis completed: ${processedCount}/${sessions.length} sessions processed`,
            data: {
                totalSessions: sessions.length,
                processedSessions: processedCount,
                failedSessions: failedSessions.length,
                analysisResults: analysisResults,
                executionTime: executionTime,
                overallScore: Math.round(overallScore * 100) / 100,
                aggregateStats: aggregateStats,
                dateRange: {
                    fromDate,
                    toDate
                },
                failedSessionDetails: failedSessions
            }
        };
        
        console.log('📤 Sending successful response with aggregate stats');
        res.json(response);
        
    } catch (error) {
        console.error('💥 Critical analysis failure:', error);
        console.error('- Error stack:', error.stack);
        
        const response = {
            success: false,
            error: error.message,
            details: 'Check server logs for more information',
            debugInfo: {
                stack: error.stack,
                code: error.code
            }
        };
        
        console.log('📤 Sending critical error response:', JSON.stringify(response, null, 2));
        res.status(500).json(response);
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    console.log('🏥 Health check requested');
    
    try {
        console.log('- Testing MongoDB connection...');
        await connectToMongoDB();
        
        const hasRequiredEnvVars = !!(
            process.env.MONGODB_URI &&
            process.env.WORKFLOW_API_URL &&
            process.env.WORKFLOW_ID &&
            process.env.API_USERNAME &&
            process.env.API_PASSWORD
        );
        
        console.log('- Environment variables check:', hasRequiredEnvVars ? 'PASS' : 'FAIL');
        
        const response = {
            status: 'healthy',
            mongodb: 'connected',
            environment: hasRequiredEnvVars ? 'configured' : 'missing variables',
            timestamp: new Date().toISOString()
        };
        
        console.log('📤 Health check response:', JSON.stringify(response, null, 2));
        res.json(response);
    } catch (error) {
        console.error('❌ Health check failed:', error.message);
        
        const response = {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
        
        console.log('📤 Unhealthy response:', JSON.stringify(response, null, 2));
        res.status(500).json(response);
    }
});

// Get session count for date range (quick preview)
app.post('/api/session-count', async (req, res) => {
    const { fromDate, toDate } = req.body;
    
    console.log('📊 Session count requested for:', fromDate, 'to', toDate);
    
    try {
        const sessions = await getChatSessions(fromDate, toDate);
        const response = {
            success: true,
            count: sessions.length,
            dateRange: { fromDate, toDate }
        };
        
        console.log('📤 Session count response:', JSON.stringify(response, null, 2));
        res.json(response);
    } catch (error) {
        console.error('❌ Session count failed:', error.message);
        
        const response = {
            success: false,
            error: error.message
        };
        
        console.log('📤 Session count error response:', JSON.stringify(response, null, 2));
        res.status(500).json(response);
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT. Graceful shutdown...');
    if (mongoClient) {
        await mongoClient.close();
        console.log('MongoDB connection closed.');
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM. Graceful shutdown...');
    if (mongoClient) {
        await mongoClient.close();
        console.log('MongoDB connection closed.');
    }
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
    console.log('✅ Processing ALL sessions (debug mode removed)');
    
    // Log environment status
    const requiredEnvVars = [
        'MONGODB_URI',
        'WORKFLOW_API_URL', 
        'WORKFLOW_ID',
        'API_USERNAME',
        'API_PASSWORD'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        console.warn('⚠️  Missing environment variables:', missingVars.join(', '));
    } else {
        console.log('✅ All required environment variables are set');
    }
    
    console.log('📋 Environment configuration:');
    console.log('- MongoDB URI:', process.env.MONGODB_URI ? '[SET]' : '[MISSING]');
    console.log('- Workflow API URL:', process.env.WORKFLOW_API_URL ? '[SET]' : '[MISSING]');
    console.log('- Workflow ID:', process.env.WORKFLOW_ID ? '[SET]' : '[MISSING]');
    console.log('- API Username:', process.env.API_USERNAME ? '[SET]' : '[MISSING]');
    console.log('- API Password:', process.env.API_PASSWORD ? '[SET]' : '[MISSING]');
    
    console.log('📊 New Scoring Formula Applied:');
    console.log('- Primary Business Metrics: 70% weight');
    console.log('- Response Quality Metrics: 20% weight');
    console.log('- User Satisfaction Indicators: 10% weight');
    console.log('- Bonus/Penalty factors included');
});
