import React from 'react';
import { BrowserRouter as Router, Switch } from "react-router-dom";
import { AuthProvider } from './components/FirebaseAuth';

import PublicRouter from './components/routers/PublicRouter';
import PublicTemplate from './components/templates/PublicTemplate';
import AccountTemplate from './components/templates/AccountTemplate';

import AuthRouter from './components/routers/AuthRouter';

import SignIn from './pages/public/SignIn';
import SignInOther from './pages/public/SignInOther';
import Home from './pages/auth/Home';
import PageNotFound from './pages/public/PageNotFound';
import AppTemplate from './components/templates/AppTemplate';
import UserProfile from './pages/auth/user/UserProfile';
import UpdateEmail from './pages/auth/user/UpdateEmail';
import UpdateName from './pages/auth/user/UpdateName';
import VerifyEmail from './pages/auth/user/VerifyEmail';
import UpdatePassword from './pages/auth/user/UpdatePassword';
import UpdatePhone from './pages/auth/user/UpdatePhone';
import UpdateResume from './pages/auth/user/UpdateResume';
import DeleteUser from './pages/auth/user/DeleteUser';
import ViewLogs from './pages/auth/user/ViewLogs';
import Plans from './pages/auth/accounts/Plans';
import CurrentPlans from './pages/auth/accounts/Plans/currentPlan';
import PaymentStatus from './pages/auth/accounts/Plans/paymentStatus';
import NewAccount from './pages/auth/accounts/NewAccount';


// load stripe
import { Elements } from '@stripe/react-stripe-js';
import {loadStripe} from '@stripe/stripe-js';
import Overview from './pages/auth/accounts/Overview';
import UserList from './pages/auth/accounts/UserList';
import UserRole from './pages/auth/accounts/UserRole';
import AddUser from './pages/auth/accounts/AddUser';
import Invite from './pages/auth/user/Invite';
import PaymentList from './pages/auth/accounts/PaymentList';
import PaymentMethod from './pages/auth/accounts/PaymentMethod';
import DeleteAccount from './pages/auth/accounts/DeleteAccount';
import HackathonList from './pages/auth/accounts/events/hackathon/HackathonList';
import HackathonRegister from './pages/auth/accounts/events/hackathon/HackathonRegister';
import HackathonEdit from './pages/auth/accounts/events/hackathon/HackathonEdit';
const stripeConfig = JSON.parse(process.env.REACT_APP_STRIPE).stripeConfig;

const stripePromise = loadStripe(stripeConfig.public_api_key);


function App() {
	return (
		<Elements stripe={stripePromise}>
			<AuthProvider>
				<Router>
					<Switch>
						<AuthRouter exact path="/" component={Home} template={AppTemplate} title="My Accounts" />
            <AuthRouter exact path="/account/:accountId/hack2022/edit/:imageId" component={HackathonEdit} template={AccountTemplate} title="Update Hackathon Registration" role="*" />
            <AuthRouter exact path="/account/:accountId/hack2022/create" component={HackathonRegister} template={AccountTemplate} title="Hackathon Registration" role="*" />
						<AuthRouter exact path="/account/:accountId/hack2022" component={HackathonList} template={AccountTemplate} title="Hackathon" role="*" />
						<AuthRouter exact path="/account/:accountId/billing/plan" component={Plans} template={AccountTemplate} title="Select Plan" role="admin" allowInactive={true} />
						<AuthRouter exact path="/account/:accountId/currentPlan" component={CurrentPlans} template={AccountTemplate} title="Current Plan" role="admin" allowInactive={true} />
						<AuthRouter exact path="/account/:accountId/billing/paymentStatus" component={PaymentStatus} template={AccountTemplate} title="Payment Status" role="admin" allowInactive={true} />
						<AuthRouter exact path="/account/:accountId/billing/payment-method" component={PaymentMethod} template={AccountTemplate} title="Update Payment Method" role="admin" />
						<AuthRouter exact path="/account/:accountId/billing/delete" component={DeleteAccount} template={AccountTemplate} title="Delete Account" role="admin" />
						<AuthRouter exact path="/account/:accountId/users/change/:userId" component={UserRole} template={AccountTemplate} title="Change Role" role="admin" />
						<AuthRouter exact path="/account/:accountId/users" component={UserList} template={AccountTemplate} title="Users" role="admin" />
						<AuthRouter exact path="/account/:accountId/users/add" component={AddUser} template={AccountTemplate} title="Add User" role="admin" />
						<AuthRouter exact path="/account/:accountId/billing" component={PaymentList} template={AccountTemplate} title="Billing" role="admin" />
						<AuthRouter exact path="/account/:accountId/" component={Overview} template={AccountTemplate} title="Overview" role="*" />
						<AuthRouter exact path="/new-account" component={NewAccount} template={AppTemplate} title="Create New Account" />
						<AuthRouter exact path="/user/profile" component={UserProfile} template={AppTemplate} title="User Profile" />
						<AuthRouter exact path="/invite/:code" component={Invite} template={AppTemplate} title="View Invite" />
						<AuthRouter exact path="/user/profile/update-email" component={UpdateEmail} template={AppTemplate} title="Change Your Email" />
						<AuthRouter exact path="/user/profile/update-name" component={UpdateName} template={AppTemplate} title="Change Your Name" />
						<AuthRouter exact path="/user/profile/verify-email" component={VerifyEmail} template={AppTemplate} title="Verify Your Name" />
						<AuthRouter exact path="/user/profile/update-password" component={UpdatePassword} template={AppTemplate} title="Change Your Password" />
						<AuthRouter exact path="/user/profile/update-phone" component={UpdatePhone} template={AppTemplate} title="Change Your Phone Number" />
						<AuthRouter exact path="/user/profile/update-resume" component={UpdateResume} template={AppTemplate} title="Update Your Resume" />
						<AuthRouter exact path="/user/profile/delete" component={DeleteUser} template={AppTemplate} title="Delete Your Account" />
						<AuthRouter exact path="/user/log" component={ViewLogs} template={AppTemplate} title="View Activity Logs" />
						<PublicRouter exact path="/signin" component={SignIn} template={PublicTemplate} title="Sign In" />
            <PublicRouter exact path="/signinAlt" component={SignInOther} template={PublicTemplate} title="Sign In (Alternate)" />
						<PublicRouter component={PageNotFound} template={PublicTemplate} title="Page Not Found" />
					</Switch>
				</Router>
			</AuthProvider>
		</Elements>
	);
}

export default App;
