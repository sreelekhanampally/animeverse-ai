import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";
const connectDB = async () => {
    try {
        const { connection } = await mongoose.connect(
            `${process.env.MONGODB_URI}/${DB_NAME}`
        );

        console.log(
            `MongoDB Connected
            Database : ${connection.name}
            Host     : ${connection.host}
            Port     : ${connection.port}`
        );
    } catch (error) {
        console.error("MongoDB Connection Failed");
        console.error(error);

        process.exit(1);
    }
};
export default connectDB;