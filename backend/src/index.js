import "dotenv/config";
import { app } from "./app.js";
import connectDB from "./db/index.js";

// dotenv.config({
//     path: "./.env",
// });



const PORT = process.env.PORT ;

const startServer = async () => {
    try {
        await connectDB();

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(`⚙️ Server running on port ${PORT}`);
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