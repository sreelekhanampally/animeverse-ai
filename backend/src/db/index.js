import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";
import { logger } from "../utils/logger.js";

const positiveInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const mongoOptions = () => ({
    serverSelectionTimeoutMS: positiveInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10_000),
    connectTimeoutMS: positiveInt(process.env.MONGODB_CONNECT_TIMEOUT_MS, 10_000),
    socketTimeoutMS: positiveInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 45_000),
    maxPoolSize: positiveInt(process.env.MONGODB_MAX_POOL_SIZE, 10),
    minPoolSize: 0,
});

const connectDB = async () => {
    const uri = `${String(process.env.MONGODB_URI || "").replace(/\/$/, "")}/${DB_NAME}`;
    const { connection } = await mongoose.connect(uri, mongoOptions());

    logger.info("mongodb_connected", {
        database: connection.name,
        host: connection.host,
        port: connection.port,
        readyState: connection.readyState,
    });

    return connection;
};

export const disconnectDB = async () => {
    if (mongoose.connection.readyState === 0) return;
    await mongoose.disconnect();
    logger.info("mongodb_disconnected");
};

export const databaseHealth = () => ({
    readyState: mongoose.connection.readyState,
    connected: mongoose.connection.readyState === 1,
});

export const dbInternals = { mongoOptions, positiveInt };
export default connectDB;
