import { registerRootComponent } from 'expo';

import './background'; // defines the background task; must run at startup, before the app renders
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
