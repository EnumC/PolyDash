const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripeConfig = require("./stripe.json");
const { PubSub } = require("@google-cloud/pubsub");

const crypto = require("crypto");
const axios = require("axios");
const url = require('url');
const Mailgun = require("mailgun-js");
const mailGunConfig = require("./mailgun.json");
const config = require("./config.json");
const inviteEmailTemplate = require("./invite_email_template.json");
const transactionEmailTemplate = require("./transaction_email_template.json");
const transactionAdminTemplate = require("./transaction_admin_template.json");

/*
To add new functions for your project, please add your new functions as function groups.
For more details, please read https://firebase.google.com/docs/functions/organize-functions#group_functions
*/
const pubsub = new PubSub();
admin.initializeApp();

const log = (uid, activity) => {
    const dt = new Date();
    const data = {
        action: activity,
        time: dt,
    };
    return admin
        .firestore()
        .collection("users")
        .doc(uid)
        .collection("activities")
        .doc(String(dt.getTime()))
        .set(data);
};

const getDoc = (docPath) => {
    const docRef = admin.firestore().doc(docPath);
    return docRef.get().then((docSnapshot) => {
        if (docSnapshot.exists) {
            return docSnapshot;
        } else {
            throw new Error("The document " + docPath + " does not exist");
        }
    });
};

// add account to firestore
const addAccount = (accountData) => {
    let acc = {
        name: accountData.name,
        owner: accountData.ownerId,
        creationTime: new Date(),
    };
    return admin
        .firestore()
        .collection("accounts")
        .add(acc)
        .then((account) => {
            return account;
        });
};

const getDocIndexById = (docArray, id) => {
    for (let i = 0; i < docArray.length; i++) {
        if (docArray[i].id === id) {
            return i;
        }
    }
    return -1;
};

const sha256hash = (str) => {
    const hash = crypto.createHash("sha256");
    hash.update(str + ":" + config.salt);
    return hash.digest("hex");
};

const sendInviteEmail = (email, senderName, inviteCode) => {
    let mailgun = new Mailgun({
        apiKey: mailGunConfig.api_key,
        domain: mailGunConfig.domain,
    });
    let inviteUrl = mailGunConfig.invite_url + "/" + inviteCode;
    if (inviteEmailTemplate.format === "html") {
        let data = {
            from: mailGunConfig.from,
            to: email,
            subject: inviteEmailTemplate.subject
                .replace(/{{sender_name}}/g, senderName)
                .replace(/{{site_name}}/g, mailGunConfig.site_name),
            html: inviteEmailTemplate.body
                .replace(/{{sender_name}}/g, senderName)
                .replace(/{{site_name}}/g, mailGunConfig.site_name)
                .replace(/{{invite_link}}/g, inviteUrl),
        };
        return mailgun.messages().send(data);
    } else {
        let data = {
            from: mailGunConfig.from,
            to: email,
            subject: inviteEmailTemplate.subject
                .replace(/{{sender_name}}/g, senderName)
                .replace(/{{site_name}}/g, mailGunConfig.site_name),
            text: inviteEmailTemplate.body
                .replace(/{{sender_name}}/g, senderName)
                .replace(/{{site_name}}/g, mailGunConfig.site_name)
                .replace(/{{invite_link}}/g, inviteUrl),
        };
        return mailgun.messages().send(data);
    }
};

const sendTransactionEmail = (email, user_name, payment_amount, payment_date, payment_status, txn_id) => {
    let mailgun = new Mailgun({
        apiKey: mailGunConfig.api_key,
        domain: mailGunConfig.domain,
    });
    let data = {
        from: mailGunConfig.from,
        to: email,
        subject: transactionEmailTemplate.subject,
        html: transactionEmailTemplate.body
            .replace(/{{user}}/g, user_name)
            .replace(/{{payment_amount}}/g, payment_amount)
            .replace(/{{payment_date}}/g, payment_date)
            .replace(/{{payment_status}}/g, payment_status)
            .replace(/{{txn_id}}/g, txn_id),
    };
    return mailgun.messages().send(data);
};

const sendTransactionAdminEmail = (email, user_email, is_valid, is_allowed, user_info, payment_amount, payment_date, payment_status, txn_id, account_id, plan_id) => {
    let mailgun = new Mailgun({
        apiKey: mailGunConfig.api_key,
        domain: mailGunConfig.domain,
    });
    let data = {
        from: mailGunConfig.from,
        to: email,
        subject: transactionAdminTemplate.subject,
        html: transactionAdminTemplate.body
            .replace(/{{is_valid}}/g, is_valid)
            .replace(/{{is_allowed}}/g, is_allowed)
            .replace(/{{user}}/g, user_info)
            .replace(/{{payment_amount}}/g, payment_amount)
            .replace(/{{payment_date}}/g, payment_date)
            .replace(/{{payment_status}}/g, payment_status)
            .replace(/{{txn_id}}/g, txn_id)
            .replace(/{{account_id}}/g, account_id)
            .replace(/{{user_email}}/g, user_email)
            .replace(/{{plan_id}}/g, plan_id),
    };
    return mailgun.messages().send(data);
};
// add a user to the account only when the user is not in the account
const addUserToAccount = (accountId, userId, isAdmin) => {
    return Promise.all([
        getDoc("accounts/" + accountId),
        getDoc("users/" + userId),
    ])
        .then(([account, user]) => {
            if (
                typeof account.data().access === "undefined" ||
                account.data().access.indexOf(user.id) === -1
            ) {
                // add user to account if user doesn't exist
                let access = [];
                let admins = [];
                if (typeof account.data().access !== "undefined") {
                    access = account.data().access;
                    admins = account.data().admins;
                }
                access.push(user.id);
                if (isAdmin) {
                    admins.push(user.id);
                }
                return account.ref.set(
                    {
                        admins: admins,
                        access: access,
                        adminCount: admins.length,
                        accessCount: access.length,
                    },
                    { merge: true }
                );
            } else {
                throw new Error("invalid account ID or user ID");
            }
        })
        .then((res) => {
            return { result: "success", accountId: accountId };
        });
};

const getStripeCustomerId = (userId, name, email, paymentMethodId) => {
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    let user = null;
    let stripeCustomerId = "";
    return getDoc("users/" + userId)
        .then((userDoc) => {
            user = userDoc;
            if (userDoc.data().stripeCustomerId) {
                return {
                    existing: true,
                    id: userDoc.data().stripeCustomerId,
                };
            } else {
                // create stripe customer
                return stripe.customers.create({
                    name: name,
                    email: email,
                    description: userId,
                });
            }
        })
        .then((customer) => {
            stripeCustomerId = customer.id;
            if (customer.existing) {
                return user;
            } else {
                return user.ref.set(
                    {
                        stripeCustomerId: customer.id,
                    },
                    { merge: true }
                );
            }
        })
        .then((res) => {
            if (paymentMethodId) {
                return stripe.paymentMethods.attach(paymentMethodId, {
                    customer: stripeCustomerId,
                });
            } else {
                return {
                    customer: stripeCustomerId,
                };
            }
        })
        .then((paymentMethod) => {
            return paymentMethod.customer;
        });
};

exports.logUserDeletion = functions.auth.user().onDelete((user) => {
    return log(user.uid, "deleted account");
});

exports.logUserCreation = functions.auth.user().onCreate((user) => {
    return log(user.uid, "created account");
});

exports.userActivityCountIncremental = functions.firestore
    .document("/users/{userId}/activities/{activityId}")
    .onCreate((snap, context) => {
        return admin
            .firestore()
            .collection("users")
            .doc(context.params.userId)
            .set(
                { activityCount: admin.firestore.FieldValue.increment(1) },
                { merge: true }
            );
    });

exports.createAccount = functions.https.onCall((data, context) => {
    return addAccount({
        name: data.accountName,
        ownerId: context.auth.uid,
    }).then((account) => {
        log(context.auth.uid, "created account id: " + account.id);
        return addUserToAccount(account.id, context.auth.uid, true);
    });
});

exports.getAccountUsers = functions.https.onCall((data, context) => {
    let account = null;
    return getDoc("/accounts/" + data.accountId)
        .then((accountRef) => {
            account = accountRef;
            if (accountRef.data().admins.indexOf(context.auth.uid) !== -1) {
                let getUsers = [];
                accountRef.data().access.forEach((userId) => {
                    getUsers.push(getDoc("users/" + userId));
                });
                return Promise.all(getUsers);
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((users) => {
            let records = [];
            users.forEach((user) => {
                records.push({
                    id: user.id,
                    displayName: user.data().displayName,
                    photoUrl: user.data().photoURL,
                    lastLoginTime: user.data().lastLoginTime.toMillis(),
                    role:
                        account.data().admins.indexOf(user.id) === -1 ? "user" : "admin",
                });
            });
            records.sort((a, b) => a.displayName > b.displayName);
            return records;
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.getAccountUser = functions.https.onCall((data, context) => {
    let account = null;
    return getDoc("/accounts/" + data.accountId)
        .then((accountRef) => {
            account = accountRef;
            if (accountRef.data().admins.indexOf(context.auth.uid) !== -1) {
                if (accountRef.data().access.indexOf(data.userId) !== -1) {
                    return getDoc("/users/" + data.userId);
                } else {
                    throw new Error("No user with ID: " + data.userId);
                }
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((user) => {
            return {
                id: user.id,
                displayName: user.data().displayName,
                photoUrl: user.data().photoURL,
                lastLoginTime: user.data().lastLoginTime.toMillis(),
                role: account.data().admins.indexOf(user.id) === -1 ? "user" : "admin",
            };
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.updateAccountUserRole = functions.https.onCall((data, context) => {
    return Promise.all([
        getDoc("accounts/" + data.accountId),
        getDoc("users/" + data.userId),
    ])
        .then(([account, user]) => {
            if (account.data().admins.indexOf(context.auth.uid) !== -1) {
                if (account.data().access.indexOf(data.userId) !== -1) {
                    switch (data.role) {
                        case "user":
                            if (account.data().admins.indexOf(data.userId) !== -1) {
                                let admins = account.data().admins;
                                admins.splice(account.data().admins.indexOf(user.id), 1);
                                return account.ref.set(
                                    {
                                        admins: admins,
                                        adminCount: admins.length,
                                    },
                                    { merge: true }
                                );
                            } else {
                                return {};
                            }
                        case "admin":
                            if (account.data().admins.indexOf(data.userId) === -1) {
                                let admins = account.data().admins;
                                admins.push(user.id);
                                return account.ref.set(
                                    {
                                        admins: admins,
                                        adminCount: admins.length,
                                    },
                                    { merge: true }
                                );
                            } else {
                                return {};
                            }
                        case "remove": {
                            let access = account.data().access;
                            access.splice(account.data().access.indexOf(user.id), 1);
                            let admins = account.data().admins;
                            if (account.data().admins.indexOf(data.userId) !== -1) {
                                admins.splice(account.data().admins.indexOf(user.id), 1);
                            }
                            return account.ref.set(
                                {
                                    access: access,
                                    accessCount: access.length,
                                    admins: admins,
                                    adminCount: admins.length,
                                },
                                { merge: true }
                            );
                        }
                        default:
                            throw new Error("Invalid role or action.");
                    }
                } else {
                    throw new Error("No user with ID: " + data.userId);
                }
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((writeResult) => {
            return {
                result: "success",
                role: data.role,
            };
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.addUserToAccount = functions.https.onCall((data, context) => {
    let account = null;
    return getDoc("/accounts/" + data.accountId)
        .then((accountRef) => {
            account = accountRef;
            if (accountRef.data().admins.indexOf(context.auth.uid) !== -1) {
                return admin.auth().getUserByEmail(data.email);
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((userRecord) => {
            if (account.data().access.indexOf(userRecord.uid) === -1) {
                // user is found in the system and has no access to the account
                return addUserToAccount(
                    data.accountId,
                    userRecord.uid,
                    data.role === "admin"
                );
            } else {
                throw new Error("The user already have access to the account.");
            }
        })
        .then((res) => {
            return res;
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message, err);
        });
});

exports.inviteEmailToAccount = functions.https.onCall((data, context) => {
    return getDoc("/accounts/" + data.accountId)
        .then((account) => {
            if (account.data().admins.indexOf(context.auth.uid) !== -1) {
                // write invite record
                const hashedEmail = sha256hash(data.email.trim().toLowerCase());
                return admin.firestore().collection("invites").add({
                    hashedEmail: hashedEmail,
                    owner: context.auth.uid,
                    account: data.accountId,
                    role: data.role,
                    time: new Date(),
                });
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((invite) => {
            // send email with invite id
            return sendInviteEmail(data.email, context.auth.token.name, invite.id);
        })
        .then((res) => {
            return {
                result: "success",
            };
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message, err);
        });
});

exports.getInvite = functions.https.onCall((data, context) => {
    return getDoc("/invites/" + data.inviteId)
        .then((invite) => {
            if (
                invite.data().hashedEmail ===
                sha256hash(context.auth.token.email.trim().toLowerCase())
            ) {
                return getDoc("/accounts/" + invite.data().account);
            } else {
                // the email doesn't match the invite's email address
                throw new Error("Invalid invite details.");
            }
        })
        .then((account) => {
            return {
                accountId: account.id,
                accountName: account.data().name,
            };
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.acceptInvite = functions.https.onCall((data, context) => {
    return getDoc("/invites/" + data.inviteId)
        .then((invite) => {
            if (
                invite.data().hashedEmail ===
                sha256hash(context.auth.token.email.trim().toLowerCase())
            ) {
                let time = new Date();
                if (
                    invite.data().time.toMillis() >
                    time.setHours(time.getHours() - config.invite_expire)
                ) {
                    return addUserToAccount(
                        invite.data().account,
                        context.auth.uid,
                        invite.data().role === "admin"
                    );
                } else {
                    throw new Error("The invite has expired.");
                }
            } else {
                // the email doesn't match the invite's email address
                throw new Error("Invalid invite details.");
            }
        })
        .then((res) => {
            return admin
                .firestore()
                .doc("/invites/" + data.inviteId)
                .delete();
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.updatePaymentMethod = functions.https.onCall((data, context) => {
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    let account = null;
    return Promise.all([
        getDoc("/accounts/" + data.accountId),
        getDoc("/users/" + context.auth.uid),
    ])
        .then(([accountDoc, userDoc]) => {
            account = accountDoc;
            // attach the payment method to the customer
            if (accountDoc.data().admins.indexOf(context.auth.uid) !== -1) {
                if (userDoc.data().stripeCustomerId) {
                    return stripe.paymentMethods.attach(data.paymentMethodId, {
                        customer: userDoc.data().stripeCustomerId,
                    });
                } else {
                    throw new Error("Subscribe to a plan first.");
                }
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((paymentMethod) => {
            // update the subscription payment method
            return stripe.subscriptions.update(
                account.data().stripeActiveSubscriptionID,
                {
                    default_payment_method: paymentMethod.id,
                }
            );
        })
        .then((subscription) => {
            return {
                result: "success",
            };
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.createPaymentIntent = functions.https.onCall((data, context) => {
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    let account = null;
    let plan = null;
    let taxRates = [];
    return Promise.all([
        getDoc("/accounts/" + data.accountId),
        getDoc("/plans/" + data.planId),
        admin.firestore().collection("taxes").get(),
    ])
        .then(([accountDoc, planDoc, taxDocs]) => {
            account = accountDoc;
            plan = planDoc;
            if (taxDocs) {
                taxDocs.forEach((taxRate) => {
                    for (let i = 0; i < taxRate.data().applicable.length; i++) {
                        if (
                            taxRate.data().applicable[i] === data.billing.country ||
                            taxRate.data().applicable[i] ===
                            data.billing.country + ":" + data.billing.state
                        ) {
                            taxRates.push(taxRate.id);
                        }
                    }
                });
            }
            if (account.data().admins.indexOf(context.auth.uid) !== -1) {
                if (data.paymentMethodId) {
                    return getStripeCustomerId(
                        context.auth.uid,
                        context.auth.token.name,
                        context.auth.token.email,
                        data.paymentMethodId
                    );
                } else {
                    return getStripeCustomerId(
                        context.auth.uid,
                        context.auth.token.name,
                        context.auth.token.email
                    );
                }
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((stripeCustomerId) => {
            return stripe.paymentIntents.create({
                amount: plan.data().price,
                currency: "usd",
                automatic_payment_methods: { enabled: true },
            });
        })
        .then((paymentIntentObj) => {
            return paymentIntentObj;
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});
exports.createSubscriptionIntent = functions.https.onCall((data, context) => {
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    let account = null;
    let plan = null;
    let taxRates = [];
    return Promise.all([
        getDoc("/accounts/" + data.accountId),
        getDoc("/plans/" + data.planId),
        admin.firestore().collection("taxes").get(),
    ])
        .then(([accountDoc, planDoc, taxDocs]) => {
            account = accountDoc;
            plan = planDoc;
            if (taxDocs) {
                taxDocs.forEach((taxRate) => {
                    for (let i = 0; i < taxRate.data().applicable.length; i++) {
                        if (
                            taxRate.data().applicable[i] === data.billing.country ||
                            taxRate.data().applicable[i] ===
                            data.billing.country + ":" + data.billing.state
                        ) {
                            taxRates.push(taxRate.id);
                        }
                    }
                });
            }
            if (account.data().admins.indexOf(context.auth.uid) !== -1) {
                if (data.paymentMethodId) {
                    return getStripeCustomerId(
                        context.auth.uid,
                        context.auth.token.name,
                        context.auth.token.email,
                        data.paymentMethodId
                    );
                } else {
                    return getStripeCustomerId(
                        context.auth.uid,
                        context.auth.token.name,
                        context.auth.token.email
                    );
                }
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((stripeCustomerId) => {
            return stripe.paymentIntents.create({
                amount: plan.data().price,
                currency: "usd",
                automatic_payment_methods: { enabled: true },
            });
        })
        .then((paymentIntentObj) => {
            return paymentIntentObj;
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.createSubscription = functions.https.onCall((data, context) => {
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    let account = null;
    let plan = null;
    let taxRates = [];
    return Promise.all([
        getDoc("/accounts/" + data.accountId),
        getDoc("/plans/" + data.planId),
        admin.firestore().collection("taxes").get(),
        isInAllowList(data.planId, data.accountId),
    ])
        .then(([accountDoc, planDoc, taxDocs, isAllowed]) => {
            account = accountDoc;
            plan = planDoc;

            if (!isAllowed) {
                let account_name = account.data().name;
                let plan_name = plan.data().name;
                throw new Error("Permission Denied. User [" + account_name + "] missing entitlement to [" + plan_name + "], [" + data.planId + "]");
            }
            if (taxDocs) {
                taxDocs.forEach((taxRate) => {
                    for (let i = 0; i < taxRate.data().applicable.length; i++) {
                        if (
                            taxRate.data().applicable[i] === data.billing.country ||
                            taxRate.data().applicable[i] ===
                            data.billing.country + ":" + data.billing.state
                        ) {
                            taxRates.push(taxRate.id);
                        }
                    }
                });
            }
            if (account.data().admins.indexOf(context.auth.uid) !== -1) {
                if (data.paymentMethodId) {
                    return getStripeCustomerId(
                        context.auth.uid,
                        context.auth.token.name,
                        context.auth.token.email,
                        data.paymentMethodId
                    );
                } else {
                    return getStripeCustomerId(
                        context.auth.uid,
                        context.auth.token.name,
                        context.auth.token.email
                    );
                }
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((stripeCustomerId) => {
            if (plan.data().price !== 0) {
                if (plan.data().stripePriceId) {
                    if (account.data().stripeActiveSubscriptionID) {
                        // retrieve subscription
                        return stripe.subscriptions.retrieve(
                            account.data().stripeActiveSubscriptionID
                        ).catch((err) => {
                            // create subscription
                            return stripe.subscriptions.create({
                                customer: stripeCustomerId,
                                default_tax_rates: taxRates,
                                default_payment_method: data.paymentMethodId,
                                items: [{ price: plan.data().stripePriceId }],
                                trial_period_days: plan.data().trialPeriod,
                            });
                        });
                    } else {
                        // create subscription
                        return stripe.subscriptions.create({
                            customer: stripeCustomerId,
                            default_tax_rates: taxRates,
                            default_payment_method: data.paymentMethodId,
                            items: [{ price: plan.data().stripePriceId }],
                            trial_period_days: plan.data().trialPeriod,
                        });
                    }
                } else {
                    throw new Error("No price ID attached to the plan.");
                }
            } else {
                if (account.data().stripeActiveSubscriptionID) {
                    // retrieve subscription
                    return stripe.subscriptions.retrieve(
                        account.data().stripeActiveSubscriptionID
                    ).catch((err) => {
                        // create subscription
                        return stripe.subscriptions.create({
                            customer: stripeCustomerId,
                            items: [{ price: plan.data().stripePriceId }],
                        });
                    });
                } else {
                    // create subscription
                    return stripe.subscriptions.create({
                        customer: stripeCustomerId,
                        items: [{ price: plan.data().stripePriceId }],
                    });
                }
            }
        })
        .then((subscription) => {
            if (account.data().stripeActiveSubscriptionID) {
                // update subscription
                if (plan.data().stripePriceId) {
                    return stripe.subscriptions.update(
                        account.data().stripeActiveSubscriptionID,
                        {
                            default_payment_method: data.paymentMethodId,
                            default_tax_rates: taxRates,
                            items: [
                                {
                                    id: subscription.items.data[0].id,
                                    price: plan.data().stripePriceId,
                                },
                            ],
                        }
                    ).catch((err) => {
                        console.log("subscription updateA fail ignored", err);
                        return subscription;
                    });
                } else {
                    return stripe.subscriptions.update(
                        account.data().stripeActiveSubscriptionID,
                        {
                            items: [
                                {
                                    id: subscription.items.data[0].id,
                                    price: plan.data().stripePriceId,
                                },
                            ],
                        }
                    ).catch((err) => {
                        console.log("subscription updateB fail ignored", err);
                        return subscription;
                    });
                }
            } else {
                return subscription;
            }
        })
        .then((subscription) => {
            return account.ref.set(
                {
                    plan: plan.ref,
                    paymentCycle: plan.data().paymentCycle,
                    price: plan.data().price,
                    currency: plan.data().currency,
                    stripeActiveSubscriptionID: subscription.id,
                    subscriptionStatus: subscription.status,
                    subscriptionCreated: subscription.created,
                    subscriptionCurrentPeriodStart: subscription.current_period_start,
                    subscriptionCurrentPeriodEnd: subscription.current_period_end,
                    subscriptionEnded: subscription.ended || 0,
                    // billingCountry: data.billing.country,
                    // billingState: data.billing.state,
                },
                { merge: true }
            );
        })
        .then((writeResult) => {
            return {
                result: "success",
            };
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.cancelSubscription = functions.https.onCall((data, context) => {
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    let account = null;
    return getDoc("accounts/" + data.accountId)
        .then((accountDoc) => {
            account = accountDoc;
            if (account.data().admins.indexOf(context.auth.uid) !== -1) {
                return stripe.subscriptions.del(
                    account.data().stripeActiveSubscriptionID
                );
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((subscription) => {
            return account.ref.set(
                {
                    subscriptionStatus: subscription.status,
                    access: [],
                    accessCount: 0,
                    admins: [],
                    adminCount: 0,
                },
                { merge: true }
            );
        })
        .then((writeResult) => {
            return {
                result: "success",
            };
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

const isInAllowList = (planID, accountID) => {
    return Promise.all([
        getDoc("accounts/" + accountID),
        getDoc("plans/" + planID),
    ])
        .then(([accountDoc, planDoc]) => {
            let account = accountDoc.data().name;
            if (typeof planDoc.data().allowList === "undefined") {
                console.log(
                    "[No allowList info found. Default to ALLOW] " + planID,
                    account
                );
                return true;
            }
            // else if (planDoc.data().allowList.indexOf(account) === -1) {
            //     //
            // }
            else {
                // found allowList for document.
                return admin
                    .firestore()
                    .collection("plans")
                    .where(admin.firestore.FieldPath.documentId(), '==', planID)
                    .where("allowList", "array-contains", account)
                    .get()
                    .then((snapshot) => {
                        if (snapshot.empty) {
                            console.log("[Not in allowList. DENY] " + planID, account);
                            return false;
                        } else {
                            console.log("[In allowList. ALLOW] " + planID, account);
                            return true;
                        }
                    });
            }
        })
        .then((res) => {
            return res;
        });
};

const updateCheckout = (checkoutParent) => {
    let checkoutObject = checkoutParent.data.object;
    // console.log("updateCheckout checkoutObject: ", checkoutObject);
    console.log("paymentStatus: ", checkoutObject.payment_status);
    console.log("checkout ID: ", checkoutObject.id);

    return admin
        .firestore()
        .collection("accounts")
        .where("stripeActiveSubscriptionID", "==", checkoutObject.id)
        .get()
        .then((snapshot) => {
            console.log("snapshot: ", snapshot);
            if (snapshot.empty) {
                throw Error(
                    "account does not exist with checkout subscription id: " +
                    checkoutObject.id
                );
            } else {
                let actions = [];
                snapshot.forEach((account) => {
                    console.log("account: ", account);
                    console.log("payment_status ", checkoutObject.payment_status);
                    actions.push(
                        account.ref.set(
                            {
                                subscriptionStatus: checkoutObject.payment_status,
                                subscriptionCreated: checkoutParent.created,
                                subscriptionCurrentPeriodStart: checkoutParent.created,
                                subscriptionCurrentPeriodEnd: 575630182800,
                                subscriptionEnded: 0,
                            },
                            { merge: true }
                        )
                    );
                });
                return Promise.all(actions);
            }
        })
        .then((writeResult) => {
            console.log("writeResult: ", writeResult);
            return true;
        })
        .catch((err) => {
            throw err;
        });
}

const updateInvoice = (invoiceObject) => {
    return admin
        .firestore()
        .collection("accounts")
        .where("stripeActiveSubscriptionID", "==", invoiceObject.subscription)
        .get()
        .then((snapshot) => {
            if (snapshot.empty) {
                console.log("[No account found]", invoiceObject.id);
                throw Error(
                    "account does not exist with subscription id: " +
                    invoiceObject.subscription
                );
            } else {
                let actions = [];
                snapshot.forEach((account) => {
                    console.log("[update invoice]", account.id, invoiceObject.id);
                    actions.push(
                        account.ref.collection("invoices").doc(invoiceObject.id).set(
                            {
                                id: invoiceObject.id,
                                total: invoiceObject.total,
                                subTotal: invoiceObject.subtotal,
                                amountDue: invoiceObject.amount_due,
                                amountPaid: invoiceObject.amount_paid,
                                tax: invoiceObject.tax,
                                currency: invoiceObject.currency,
                                created: invoiceObject.created,
                                status: invoiceObject.status,
                                hostedInvoiceUrl: invoiceObject.hosted_invoice_url,
                            },
                            { merge: true }
                        )
                    );
                });
                return Promise.all(actions);
            }
        })
        .then((writeResult) => {
            return true;
        })
        .catch((err) => {
            throw err;
        });
};

const updateSubscription = (subscriptionObject) => {
    return admin
        .firestore()
        .collection("accounts")
        .where("stripeActiveSubscriptionID", "==", subscriptionObject.id)
        .get()
        .then((snapshot) => {
            if (snapshot.empty) {
                throw Error(
                    "account does not exist with subscription id: " +
                    subscriptionObject.id
                );
            } else {
                let actions = [];
                snapshot.forEach((account) => {
                    actions.push(
                        account.ref.set(
                            {
                                subscriptionStatus: subscriptionObject.status,
                                subscriptionCreated: subscriptionObject.created,
                                subscriptionCurrentPeriodStart:
                                    subscriptionObject.current_period_start,
                                subscriptionCurrentPeriodEnd:
                                    subscriptionObject.current_period_end,
                                subscriptionEnded: subscriptionObject.ended || 0,
                            },
                            { merge: true }
                        )
                    );
                });
                return Promise.all(actions);
            }
        })
        .then((writeResult) => {
            return true;
        })
        .catch((err) => {
            throw err;
        });
};

exports.stripeWebHook = functions.https.onRequest((req, res) => {
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    const endpointSecret = stripeConfig.endpoint_secret;
    const sig = req.headers["stripe-signature"];
    let event;
    try {
        let result = false;
        event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
        console.log("[Stripe Event]", event.type);
        if (event.type.indexOf("invoice.") === 0) {
            result = updateInvoice(event.data.object);
        }
        if (event.type.indexOf("customer.subscription.") === 0) {
            result = updateSubscription(event.data.object);
        }
        if (event.type.indexOf("checkout.") === 0) {
            result = updateCheckout(event);
        }
        if (result) {
            res.json({ received: true });
        } else {
            throw Error("unknown error");
        }
    } catch (err) {
        console.log(`Webhook Error: ${err.message}`);
        res.status(400).send(`Webhook Error: ${err.message}`);
    }
});

async function publishMessage(messageConfig) {
    try {

        const topicName = messageConfig.topicName;
        const pubSubPayload = messageConfig.pubSubPayload;

        let dataBuffer = Buffer.from(JSON.stringify(pubSubPayload));
        await pubsub.topic(topicName).publish(dataBuffer);

    } catch (error) {
        throw error;
    }
}

exports.processPaypal = functions.pubsub.topic('paypal').onPublish((message) => {
    console.log("[PayPal PubSub 1]");
    // Check request for validity/tamper
    // let paypalEndpoint = "https://ipnpb.sandbox.paypal.com/cgi-bin/webscr" // TESTING - Sandbox API
    let paypalEndpoint = "https://ipnpb.paypal.com/cgi-bin/webscr" // Production API
    // const paramsPP = new url.URLSearchParams(message.json);
    const paramsPP = new url.URLSearchParams({ cmd: "_notify-validate" });
    for (const [key, value] of Object.entries(message.json)) {
        paramsPP.append(key, value)
    }
    return axios.post(paypalEndpoint, paramsPP.toString())
        .then(function (response) {
            let validTicket = false;
            if (response.data === "VERIFIED") {
                validTicket = true;
                console.log("Success and verified.");
            }
            else {
                console.log("WARNING: FAILED TO VALIDATE TRANSACTION.");
                console.log(response.data);
                console.log(response.status);
                console.log(response.statusText);
                console.log(response.headers);
                console.log("Done");
            }
            console.log("Done");
            return updateCheckoutPayPal(message.json, validTicket)
        })
        .catch(function (error) {
            console.error("Error sending validation request");
            console.log(error);
        });
});

exports.paypalWebhook = functions.https.onRequest((req, res) => {
    try {
        console.log("[PayPal Event]");

        var messageConfig = {
            topicName: 'paypal',
            pubSubPayload: req.body
        }
        publishMessage(messageConfig)
            .then((msgRes) => {
                console.log("paypal pubsub trigger OK")
                res.status(200).send(`OK`);
            })

    } catch (err) {
        console.log(`Webhook Error: ${err.message}`);
        res.status(400).send(`Webhook Error: ${err.message}`);
    }
});

const sendDebug = (obj) => {
    // For testing:
    const params = new url.URLSearchParams(obj);
    return axios.post('', params.toString())
    .then(function (response) {
      console.log("Debug Send Success");
      // console.log(response);
    })
    .catch(function (error) {
      console.error("Debug Send Error");
      // console.log(error);
    });
}
const updateCheckoutPayPal = (checkoutObject, isValid) => {
    // console.log("updateCheckout checkoutObject: ", checkoutObject);
    let account_id = checkoutObject.option_selection1;
    let plan_id = checkoutObject.option_selection2;
    let payment_status = checkoutObject.payment_status;
    let txn_id = checkoutObject.txn_id;
    let userInfoExtend = checkoutObject.custom;
    let payment_date = checkoutObject.payment_date;
    console.log("paymentStatus: ", payment_status);
    console.log("checkout ID: ", txn_id);
    console.log("validTicket: ", isValid);
    console.log("accountID: ", account_id);
    console.log("planId: ", plan_id);
    console.log("userNameEmail: ", userInfoExtend);
    console.log("paymentDate: ", payment_date);
    return Promise.all([
        // sendDebug(checkoutObject), // for debug only!
        getDoc("/accounts/" + account_id),
        getDoc("/plans/" + plan_id),
        isInAllowList(plan_id, account_id),
    ])
        .then(([_dbgInfo, accountDoc, planDoc, isAllowed]) => {
            console.log("accountDoc: ", accountDoc);
            console.log("planDoc", planDoc);
            console.log("isAllowed", isAllowed);
            if (accountDoc.empty) {
                throw Error(
                    "account does not exist:" +
                    account_id
                );
            } else {
                let actions = [];
                actions.push(
                    accountDoc.ref.set(
                        {
                            subscriptionStatus: payment_status,
                            subscriptionCreated: payment_date,
                            subscriptionCurrentPeriodStart: payment_date,
                            subscriptionCurrentPeriodEnd: 575630182800,
                            subscriptionEnded: !isValid || !isAllowed || 0, // mark as ended if tx failed validatio/user not allowed.
                            price: checkoutObject.payment_gross,
                            plan: planDoc.ref,
                            paymentCycle: planDoc.data().paymentCycle,
                            currency: checkoutObject.mc_currency,
                            stripeActiveSubscriptionID: "n/a",
                            // Add entire object to detail for audit
                            trans_log: admin.firestore.FieldValue.arrayUnion(Object.assign({}, checkoutObject, {validTicket: isValid}))
                        },
                        { merge: true }
                    )
                );
                let user_email = accountDoc.data().name;
                actions.push(sendTransactionEmail(user_email, userInfoExtend, checkoutObject.payment_gross, payment_date, payment_status, txn_id));
                actions.push(sendTransactionAdminEmail("invitations@calpolyhkn.com", user_email, isValid, isAllowed, userInfoExtend, checkoutObject.payment_gross, payment_date, payment_status, txn_id, account_id, plan_id));
                return Promise.all(actions);
            }
        })
}

exports.checkoutSession = functions.https.onCall((data, context) => {
    if (data === undefined || data.sessionId === undefined) {
        return {
            result: "error",
            data: "CheckoutSession Error: data is undefined."
        };
    }
    const sessionId = data.sessionId;
    console.log("Session ID:", sessionId);
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    return stripe.checkout.sessions.retrieve(sessionId)
        .then((res) => {
            if (res.payment_status === "paid") {
                return admin
                    .firestore()
                    .collection("accounts")
                    .where("stripeActiveSubscriptionID", "==", res.id)
                    .get()
                    .then((snapshot) => {
                        console.log("snapshot: ", snapshot);
                        if (snapshot.empty) {
                            throw Error(
                                "checkoutSession: account does not exist with checkout subscription id: " +
                                res.id
                            );
                        } else {
                            let actions = [];
                            snapshot.forEach((account) => {
                                console.log("checkoutSession account: ", account);
                                console.log("checkoutSession payment_status ", res.payment_status);
                                actions.push(
                                    account.ref.set(
                                        {
                                            subscriptionStatus: res.payment_status
                                        },
                                        { merge: true }
                                    )
                                );
                            });
                            return Promise.all(actions);
                        }
                    })
                    .then((writeResult) => {
                        console.log("checkoutSession writeResult: ", writeResult);
                        return {
                            result: "success",
                            data: res
                        };
                    })
                    .catch((err) => {
                        throw err;
                    });
            }
            return {
                result: "success",
                data: res
            };
        })
        .catch((err) => {
            throw err;
        });;
});


exports.createCheckoutSession = functions.https.onCall((data, context) => {
    const stripe = require("stripe")(stripeConfig.secret_api_key);
    const domainURL = stripeConfig.domainURL;
    let account = null;
    let plan = null;
    let taxRates = [];
    return Promise.all([
        getDoc("/accounts/" + data.accountId),
        getDoc("/plans/" + data.planId),
        admin.firestore().collection("taxes").get(),
        isInAllowList(data.planId, data.accountId),
    ])
        .then(([accountDoc, planDoc, taxDocs, isAllowed]) => {
            account = accountDoc;
            plan = planDoc;

            if (!isAllowed) {
                let account_name = account.data().name;
                let plan_name = plan.data().name;
                throw new Error("Permission Denied. User [" + account_name + "] missing entitlement to [" + plan_name + "], [" + data.planId + "]");
            }
            if (taxDocs) {
                taxDocs.forEach((taxRate) => {
                    for (let i = 0; i < taxRate.data().applicable.length; i++) {
                        if (
                            taxRate.data().applicable[i] === data.billing.country ||
                            taxRate.data().applicable[i] ===
                            data.billing.country + ":" + data.billing.state
                        ) {
                            taxRates.push(taxRate.id);
                        }
                    }
                });
            }
            if (account.data().admins.indexOf(context.auth.uid) !== -1) {
                if (data.paymentMethodId) {
                    return getStripeCustomerId(
                        context.auth.uid,
                        context.auth.token.name,
                        context.auth.token.email,
                        data.paymentMethodId
                    );
                } else {
                    return getStripeCustomerId(
                        context.auth.uid,
                        context.auth.token.name,
                        context.auth.token.email
                    );
                }
            } else {
                throw new Error("Permission denied.");
            }
        })
        .then((stripeCustomerId) => {
            if (plan.data().stripePriceId) {
                // create subscription
                return stripe.checkout.sessions.create({
                    customer: stripeCustomerId,
                    mode: data.mode,
                    line_items: [{
                        price: plan.data().stripePriceId,
                        quantity: 1,
                    }],
                    allow_promotion_codes: true,
                    // ?session_id={CHECKOUT_SESSION_ID} means the redirect will have the session ID set as a query param
                    success_url: `${domainURL}/account/${data.accountId}/billing/paymentStatus?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${domainURL}/account/${data.accountId}/billing/paymentStatus?session_id={CHECKOUT_SESSION_ID}`,
                });
            } else {
                throw new Error("No price ID attached to the plan.");
            }
        })
        .then((sessionObj) => {
            return account.ref.set(
                {
                    plan: plan.ref,
                    paymentCycle: plan.data().paymentCycle,
                    price: plan.data().price,
                    currency: plan.data().currency,
                    stripeActiveSubscriptionID: sessionObj.id,
                    subscriptionStatus: sessionObj.status
                },
                { merge: true }
            ).then((res => {
                return sessionObj;
            }))

        })
        .then((writeResult) => {
            return {
                result: "success",
                url: writeResult.url
            };
        })
        .catch((err) => {
            throw new functions.https.HttpsError("internal", err.message);
        });
});

exports.incrementInvoicesCollectionCount = functions.firestore
    .document("accounts/{accountId}/invoices/{invoiceId}")
    .onCreate((snap, context) => {
        return admin
            .firestore()
            .doc("/accounts/" + context.params.accountId)
            .update({ invoicesColCount: admin.firestore.FieldValue.increment(1) });
    });
