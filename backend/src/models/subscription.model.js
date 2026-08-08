import mongoose, {Schema} from "mongoose"

const subscriptionSchema = new Schema({
    subscriber: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    channel: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
},{timestamps: true} )

// A user may subscribe to a channel at most once. Without this, a burst of
// toggle requests could each pass the "already subscribed?" read before any of
// them wrote, creating several identical documents and inflating
// subscribersCount permanently. The only index that existed before was _id.
subscriptionSchema.index({ subscriber: 1, channel: 1 }, { unique: true })

export const Subscription = mongoose.model("Subscription", subscriptionSchema)