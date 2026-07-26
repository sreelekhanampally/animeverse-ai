import "dotenv/config";
import { app } from "./app.js";
import connectDB from "./db/index.js";

// dotenv.config({
//     path: "./.env",
// });



const PORT = process.env.PORT || 8000;

const startServer = async () => {
    try {
        await connectDB();

        const server = app.listen(PORT, () => {
            console.log(` ⚙️ Server running on http://localhost:${PORT}`);
        });

        server.on("error", (error) => {
            console.error("Server Error:", error);
            process.exit(1);
        });

    } catch (error) {
        console.error("Database Connection Failed:", error);
        process.exit(1);
    }
};

startServer();