const { db } = require('./src/db/db');
const { DailyPlanGenerator } = require('./src/services/growthEngine');
(async () => {
    const models = await db.models.toArray();
    console.log('Models:', models);
    if (models.length === 0) {
        console.log('No models found');
        return;
    }
    const modelId = models[0].id;
    console.log('Generating tasks for model', modelId);
    const tasks = await DailyPlanGenerator.generateDailyPlan(modelId);
    console.log('Generated tasks count:', tasks.length);
    console.log('Tasks:', tasks);
})();
