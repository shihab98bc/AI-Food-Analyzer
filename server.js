require('dotenv').config(); 
const express = require('express');
const fetch = require('node-fetch'); 
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Middleware
app.use(express.json({ limit: '10mb' })); 
app.use(express.static(path.join(__dirname, 'public'))); 

// API endpoint to handle image analysis
app.post('/api/analyze-image', async (req, res) => {
    const { imageBase64 } = req.body;

    if (!GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY is not defined in .env file.');
        return res.status(500).json({ error: 'Server configuration error: API key missing.' });
    }

    if (!imageBase64) {
        return res.status(400).json({ error: 'No image data provided.' });
    }

    try {
        // Step 1: Get image description from Gemini (Server-side)
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
            console.error('Server: Error from Gemini (description):', errorData);
            return res.status(descriptionResponse.status).json({ error: `Error describing image: ${errorData.error?.message || descriptionResponse.statusText}` });
        }

        const descriptionResult = await descriptionResponse.json();
        const foodDescription = descriptionResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!foodDescription) {
            console.error('Server: Could not extract food description from Gemini response.');
            return res.status(500).json({ error: "Could not get a description of the food from the image." });
        }
        console.log('Server: Received food description (first 100 chars):', foodDescription.substring(0, 100) + '...');

        // Step 2: Get structured food/calorie data from the description (Server-side)
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
            console.error('Server: Error from Gemini (nutrition):', errorData);
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
        console.error("Server-side analysis error:", error);
        res.status(500).json({ error: 'An internal server error occurred during analysis.' });
    }
});

// Serve the main HTML file for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`AI Food Analyzer server running on http://localhost:${PORT}`);
    if (!GEMINI_API_KEY) {
        console.warn('--------------------------------------------------------------------');
        console.warn('Warning: GEMINI_API_KEY is not set in your .env file!');
        console.warn('The application will not be able to connect to the Gemini API.');
        console.warn('Please create a .env file with your GEMINI_API_KEY.');
        console.warn('Example .env file contents:');
        console.warn('GEMINI_API_KEY=your_actual_api_key_here');
        console.warn('PORT=3000');
        console.warn('--------------------------------------------------------------------');
    }
});
