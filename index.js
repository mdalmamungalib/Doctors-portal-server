const express = require('express');
const cors = require('cors');
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require("stripe")('sk_test_51NmrjxHPZpXZKM21eeUpHc9QpgR1IhyiAbmNfEm3Z6s59IY5lwqqrHAole39nSl44gl5C4PlcOfJhwcElqvk561C00ageSRk44');

const app = express();
app.use(cors());

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// mongodb connected
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.so7cytz.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

function verifyJWT(req, res, next) {

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.JWT_SECRATE_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })

}

async function run() {
    try {
        const appointmentOptionCollection = client.db("doctorsPortel").collection("appointmentOptions");
        const bookingCollection = client.db("doctorsPortel").collection("bookings");
        const usersCollection = client.db("doctorsPortel").collection("users");
        const doctorsCollection = client.db("doctorsPortel").collection("doctors");
        const paymentsCollection = client.db("doctorsPortel").collection("payments");
        const usersReviewCollection = client.db("doctorsPortel").collection("usersReview");

        //NOTE: Make sure you use verifyJWT  after verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== "admin") {
                return res.status(403).send({ message: "Forbidden access" });
            };
            next();
        }

        //appointmentOptions get data
        app.get("/appointmentOptions", async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();
            const bookingQuery = { appointmentDate: date };
            const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlot = optionBooked.map(book => book.slot);
                const remainingSlot = option.slots.filter(slot => !bookedSlot.includes(slot));
                option.slots = remainingSlot;
            });
            res.send(options);
        });

        app.get("/appointmentSpecialty", async (req, res) => {
            const result = await appointmentOptionCollection.find({}).project({ name: 1 }).toArray();
            res.send(result);
        })

        app.get("/bookings", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded?.email;
            console.log(decodedEmail)
            if (email !== decodedEmail) {
                return res.status(403).send({ message: "Forbidden access" });
            };
            const query = { email: email };
            const bookings = await bookingCollection.find(query).toArray();
            res.send(bookings);
        })

        //booking data insert
        app.post("/bookings", async (req, res) => {
            const booking = req.body;
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            };
            const alreadyBooked = await bookingCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You already booking have a booking on ${booking.appointmentDate}`;
                return res.send({
                    acknowledged: false,
                    message
                })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send(result)
        });

        app.get("/bookings/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        });

        app.get("/jwt", async (req, res) => {
            client.connect()
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.JWT_SECRATE_TOKEN, { expiresIn: "1d" });
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: "mt" })
        });

        app.post("/users", async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });


        // get all user data
        app.get("/allUsers", verifyJWT, async (req, res) => {
            const query = {};
            const result = await usersCollection.find(query).toArray();
            res.send(result);
        });

        //update user data add role admin data
        app.put("/allUsers/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);
            if (user.role !== "admin") {
                return res.status(403).send({ massage: "Forbidden access" })
            }
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: "admin"
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        });

        app.get('/allUsers/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        });

        app.delete("/deleteUser/:id", async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(filter);
            res.send(result);
        })

        // temporary to update
        app.get("/addPrice", async (req, res) => {
            const filter = {};
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    price: 250
                }
            };
            const result = await appointmentOptionCollection.updateMany(filter, updateDoc, options);
            res.send(result);
        })



        app.post("/doctors", verifyJWT, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });

        app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
            const result = await doctorsCollection.find({}).toArray();
            res.send(result);
        });

        app.delete("/doctors/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        });

        app.post("/create-payment-intent", async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: "usd",
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.post("/payments", async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            };
            const updatedResult = await bookingCollection.updateOne(filter, updateDoc, options);

            res.send(result);
        });

        app.post("/review", verifyJWT, async (req, res) => {
            const review = req.body;
            const result = await usersReviewCollection.insertOne(review);
            res.send(result);
        });

        app.get("/review", verifyJWT, async (req, res) => {
            const query = {};
            const result = await usersReviewCollection.find(query).toArray();
            console.log("review email", result.email)
            res.send(result);
        });

        app.delete("/deleteReviews/:id", async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await usersReviewCollection.deleteOne(filter);
            res.send(result);
        });

    } finally {

    }
}
run().catch(console.dir);


app.get("/", (req, res) => {
    res.send(`Server side running on port ${port}`)
});

app.listen(port, () => {
    console.log(`Server side running on port ${port}`)
});