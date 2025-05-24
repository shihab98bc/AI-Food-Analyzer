require('dotenv').config(); 
const express = require('express');
const fetch = require('node-fetch'); 
const path = require('path');

const app = express();
// Vercel injects its own PORT environment variable.
// Use it if available, otherwise default for local development.
const PORT = process.env.PORT || 3000; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Middleware
app.use(express.json({ limit: '10mb' })); 
// Serve static files from the 'public' directory
// This is important for Vercel when server.js handles all routes
app.use(express.static(path.join(__dirname, 'public'))); 

// API endpoint to handle image analysis
app.post('/api/analyze-image', async (req, res) => {
    const { imageBase64 } = req.body;

    if (!GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY is not defined. Check Vercel environment variables.');
        return res.status(500).json({ error: 'Server configuration error: API key missing.' });
    }

    if (!imageBase64) {
        return res.status(400).json({ error: 'No image data provided.' });
    }

    try {
        const imageDescriptionPrompt = "Describe the food items visible in this image in detail. Focus on identifiable ingredients and dishes.";
        const descriptionPayload = {
            contents: [{
                parts: [
                    { text: imageDescriptionPrompt },
                    { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }
                ]
            }]
        };
        
        const descriptionApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        console.log('Server: Calling Gemini for description...');
        const descriptionResponse = await fetch(descriptionApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(descriptionPayload)
        });

        if (!descriptionResponse.ok) {
            const errorData = await descriptionResponse.json();
            console.error('Server: Error from Gemini (description):', errorData.error ? errorData.error.message : descriptionResponse.statusText);
            return res.status(descriptionResponse.status).json({ error: `Error describing image: ${errorData.error?.message || descriptionResponse.statusText}` });
        }

        const descriptionResult = await descriptionResponse.json();
        const foodDescription = descriptionResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!foodDescription) {
            console.error('Server: Could not extract food description from Gemini response.');
            return res.status(500).json({ error: "Could not get a description of the food from the image." });
        }
        console.log('Server: Received food description (first 100 chars):', foodDescription.substring(0, 100) + '...');

        const nutritionAnalysisPrompt = `Based on the following food description, identify distinct food items and estimate their calorie content.
        Description: "${foodDescription}"
        Provide your response as a JSON array of objects, where each object has "foodItem" (string) and "estimatedCalories" (number, integer) properties.
        Example: [{"foodItem": "Apple", "estimatedCalories": 95}, {"foodItem": "Slice of Pizza", "estimatedCalories": 285}]
        If you cannot identify specific items or calories, return an empty array or items with 0 calories. Be realistic with calorie estimates.`;

        const nutritionPayload = {
            contents: [{ parts: [{ text: nutritionAnalysisPrompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            foodItem: { type: "STRING", description: "Name of the food item" },
                            estimatedCalories: { type: "NUMBER", description: "Estimated calories for the food item" }
                        },
                        required: ["foodItem", "estimatedCalories"]
                    }
                }
            }
        };
        
        const nutritionApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

        console.log('Server: Calling Gemini for nutrition analysis...');
        const nutritionResponse = await fetch(nutritionApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nutritionPayload)
        });

        if (!nutritionResponse.ok) {
            const errorData = await nutritionResponse.json();
            console.error('Server: Error from Gemini (nutrition):', errorData.error ? errorData.error.message : nutritionResponse.statusText);
            return res.status(nutritionResponse.status).json({ error: `Error analyzing nutrition: ${errorData.error?.message || nutritionResponse.statusText}` });
        }
        
        const nutritionResult = await nutritionResponse.json();
        const analysisJsonString = nutritionResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!analysisJsonString) {
            console.error('Server: Could not extract nutrition analysis JSON from Gemini response.');
            return res.status(500).json({ error: "Could not get nutrition analysis from the description." });
        }
        console.log('Server: Received nutrition analysis JSON string (first 100 chars):', analysisJsonString.substring(0,100) + '...');

        res.setHeader('Content-Type', 'application/json');
        res.send(analysisJsonString); 

    } catch (error) {
        console.error("Server-side analysis error:", error.message);
        res.status(500).json({ error: 'An internal server error occurred during analysis.' });
    }
});

// Serve the main HTML file for all other GET requests (SPA-like behavior)
// This is crucial for Vercel when server.js handles all routes
// Ensure this is AFTER your API routes
app.get('*', (req, res) => {
    // Check if the request is for an API endpoint, if so, it should have been handled above
    // This is a fallback for serving the index.html for frontend routing, if any.
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        // If it's an unhandled API route, send a 404
        res.status(404).send('API route not found');
    }
});


// Only start listening if the GEMINI_API_KEY is available (for local dev)
// Vercel will manage the server lifecycle itself.
if (require.main === module && GEMINI_API_KEY) {
    app.listen(PORT, () => {
        console.log(`AI Food Analyzer server running locally on http://localhost:${PORT}`);
    });
} else if (require.main === module && !GEMINI_API_KEY) {
    console.warn('--------------------------------------------------------------------');
    console.warn('Warning: GEMINI_API_KEY is not set in your .env file for local development!');
    console.warn('The application will not be able to connect to the Gemini API locally.');
    console.warn('Please create a .env file with your GEMINI_API_KEY.');
    console.warn('Example .env file contents:');
    console.warn('GEMINI_API_KEY=your_actual_api_key_here');
    console.warn('PORT=3000');
    console.warn('--------------------------------------------------------------------');
    console.log('Server not started due to missing API key for local development.');
}

// Export the app for Vercel's serverless environment
module.exports = app;
