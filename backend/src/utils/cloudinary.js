import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload Function
const uploadOnCloudinary = async (localFilePath) => {
    // console.log("uploadOnCloudinary called");
    // console.log("Path:", localFilePath);
    try {
        if (!localFilePath) return null;

        const response = await cloudinary.uploader.upload(
            localFilePath,
            {
                folder: "youtube-clone",
                resource_type: "auto",
            }
        );

        // Delete local file after successful upload
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }

        console.log(
            "Cloudinary Upload Successful:",
            response.secure_url
        );

        return response;
    } catch (error) {
        // Delete local file if upload fails
        console.error("Cloudinary Upload Error:", error);
        if (localFilePath && fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }

        console.error("Cloudinary Upload Error:", error);

        return null;
    }
};

const deleteFromCloudinary = async (
    publicId,
    resourceType = "image"
) => {
    try {
        if (!publicId) return null;

        return await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType
        });
    } catch (error) {
        console.log("Cloudinary delete error:", error);
        return null;
    }
};

const getPublicIdFromUrl = (url) => {
    if (!url) return null;

    const parts = url.split("/");
    const fileName = parts.pop();
    const folder = parts.slice(parts.indexOf("upload") + 2).join("/");

    return `${folder}/${fileName.split(".")[0]}`;
};

export { uploadOnCloudinary, deleteFromCloudinary, getPublicIdFromUrl};