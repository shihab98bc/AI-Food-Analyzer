require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze-image', async (req, res) => {
    const { imageBase64 } = req.body;

    if (!GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY is not defined. Check environment variables.');
        return res.status(500).json({ error: 'Server configuration error: API key missing.' });
    }
    if (!imageBase64) {
        return res.status(400).json({ error: 'No image data provided.' });
    }

    try {
        const geminiApiUrlBase = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

        // --- Step 1: Get image description ---
        const imageDescriptionPrompt = "Describe the food items visible in this image in detail. Focus on identifiable ingredients and dishes.";
        const descriptionPayload = {
            contents: [{ parts: [{ text: imageDescriptionPrompt }, { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }] }]
        };
        console.log('Server: Calling Gemini for image description...');
        const descriptionResponse = await fetch(geminiApiUrlBase, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(descriptionPayload)
        });
        if (!descriptionResponse.ok) {
            const errorData = await descriptionResponse.json();
            console.error('Server: Error from Gemini (description):', errorData.error ? errorData.error.message : descriptionResponse.statusText);
            return res.status(descriptionResponse.status).json({ error: `Error describing image: ${errorData.error?.message || descriptionResponse.statusText}` });
        }
        const descriptionResult = await descriptionResponse.json();
        const foodDescription = descriptionResult.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!foodDescription) {
            console.error('Server: Could not extract food description.');
            return res.status(500).json({ error: "Could not get a description of the food." });
        }
        console.log('Server: Received food description (first 100 chars):', foodDescription.substring(0, 100) + '...');

        // --- Step 2: Get structured food/calorie data ---
        const nutritionAnalysisPrompt = `Based on the following food description, identify distinct food items and estimate their calorie content.
        Description: "${foodDescription}"
        Provide your response as a JSON array of objects, where each object has "foodItem" (string) and "estimatedCalories" (number, integer) properties.
        Example: [{"foodItem": "Apple", "estimatedCalories": 95}, {"foodItem": "Slice of Pizza", "estimatedCalories": 285}]
        If you cannot identify specific items or calories, return an empty array or items with 0 calories. Be realistic with calorie estimates.`;
        const nutritionPayload = {
            contents: [{ parts: [{ text: nutritionAnalysisPrompt }] }],
            generationConfig: { 
                responseMimeType: "application/json",
                responseSchema: { // Added schema for robustness
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            foodItem: { type: "STRING" },
                            estimatedCalories: { type: "NUMBER" }
                        },
                        required: ["foodItem", "estimatedCalories"]
                    }
                }
            }
        };
        console.log('Server: Calling Gemini for nutrition analysis...');
        const nutritionResponse = await fetch(geminiApiUrlBase, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nutritionPayload)
        });
        if (!nutritionResponse.ok) {
            const errorData = await nutritionResponse.json();
            console.error('Server: Error from Gemini (nutrition):', errorData.error ? errorData.error.message : nutritionResponse.statusText);
            return res.status(nutritionResponse.status).json({ error: `Error analyzing nutrition: ${errorData.error?.message || nutritionResponse.statusText}` });
        }
        const nutritionResult = await nutritionResponse.json();
        const foodItemsJsonString = nutritionResult.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!foodItemsJsonString) {
            console.error('Server: Could not extract nutrition JSON.');
            return res.status(500).json({ error: "Could not get nutrition analysis." });
        }
        console.log('Server: Received nutrition analysis JSON (first 100 chars):', foodItemsJsonString.substring(0,100) + '...');
        
        let foodItemsArray = [];
        try {
            foodItemsArray = JSON.parse(foodItemsJsonString);
        } catch (e) {
            console.error('Server: Failed to parse foodItemsJsonString:', e);
            return res.status(500).json({ error: "Failed to parse nutrition data from AI." });
        }

        // --- Step 3: Get meal/recipe name ---
        let mealName = "Suggested Meal"; 
        if (foodItemsArray.length > 0) {
            const identifiedItemsString = foodItemsArray.map(item => item.foodItem).join(', ');
            const mealNamePrompt = `Given the following food items: "${identifiedItemsString}", suggest a concise and appealing name for this meal or recipe. 
            If it's a collection of unrelated items, you can suggest 'Assorted Plate', 'Mixed Meal', or similar.
            Respond with ONLY the suggested name as a plain string. For example: "Hearty Vegetable Stir-fry". Do not include any other text or JSON formatting.`;
            const mealNamePayload = { contents: [{ parts: [{ text: mealNamePrompt }] }] };
            console.log('Server: Calling Gemini for meal name...');
            const mealNameResponse = await fetch(geminiApiUrlBase, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mealNamePayload)
            });
            if (mealNameResponse.ok) {
                const mealNameResult = await mealNameResponse.json();
                const suggestedNameText = mealNameResult.candidates?.[0]?.content?.parts?.[0]?.text;
                if (suggestedNameText) mealName = suggestedNameText.trim();
                console.log('Server: Received meal name:', mealName);
            } else {
                console.warn('Server: Error from Gemini (meal name), using default.');
            }
        } else {
            mealName = "No items identified to name.";
        }

        // --- Step 4: Get recipe/preparation steps ---
        let recipeSteps = "No recipe steps available for this combination.";
        if (foodItemsArray.length > 0) {
            const recipePrompt = `Provide simple preparation steps or a basic recipe for a meal named "${mealName}" which includes items like: ${foodItemsArray.map(item => item.foodItem).join(', ')}.
            Keep the steps brief and easy to follow. If it's a simple assembly, describe that.
            Respond with plain text, using numbered steps or clear paragraphs. For example: 
            1. Chop vegetables. 
            2. Sauté onions and garlic. 
            3. Add remaining ingredients and simmer.
            Or: "Combine all ingredients in a bowl and toss with dressing."`;
            const recipePayload = { contents: [{ parts: [{ text: recipePrompt }] }] };
            console.log('Server: Calling Gemini for recipe steps...');
            const recipeResponse = await fetch(geminiApiUrlBase, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipePayload)
            });
            if (recipeResponse.ok) {
                const recipeResult = await recipeResponse.json();
                const stepsText = recipeResult.candidates?.[0]?.content?.parts?.[0]?.text;
                if (stepsText) recipeSteps = stepsText.trim();
                console.log('Server: Received recipe steps (first 100 chars):', recipeSteps.substring(0, 100) + '...');
            } else {
                console.warn('Server: Error from Gemini (recipe steps), using default.');
            }
        }


        // --- Combine results and send to client ---
        const finalResponse = {
            mealName: mealName,
            foodItems: foodItemsArray,
            recipeSteps: recipeSteps
        };
        res.setHeader('Content-Type', 'application/json');
        res.json(finalResponse);

    } catch (error) {
        console.error("Server-side analysis error:", error.message, error.stack);
        res.status(500).json({ error: 'An internal server error occurred during analysis.' });
    }
});

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).send('API route not found');
    }
});

if (require.main === module && GEMINI_API_KEY) {
    app.listen(PORT, () => {
        console.log(`AI Food Analyzer server running locally on http://localhost:${PORT}`);
    });
} else if (require.main === module && !GEMINI_API_KEY) {
    console.warn('--------------------------------------------------------------------');
    console.warn('Warning: GEMINI_API_KEY is not set for local development!');
    console.warn('--------------------------------------------------------------------');
    console.log('Server not started due to missing API key for local development.');
}

module.exports = app;
