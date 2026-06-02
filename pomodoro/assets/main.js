(self["webpackChunkapp"] = self["webpackChunkapp"] || []).push([["main"],{

/***/ 6698:
/*!******************************************!*\
  !*** ./src/app/about/about.component.ts ***!
  \******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "AboutComponent": () => (/* binding */ AboutComponent)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _about_component_html_ngResource__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./about.component.html?ngResource */ 5133);
/* harmony import */ var _about_component_scss_ngResource__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./about.component.scss?ngResource */ 5724);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @angular/core */ 2560);




let AboutComponent = class AboutComponent {
    constructor() { }
    ngOnInit() { }
};
AboutComponent.ctorParameters = () => [];
AboutComponent = (0,tslib__WEBPACK_IMPORTED_MODULE_2__.__decorate)([
    (0,_angular_core__WEBPACK_IMPORTED_MODULE_3__.Component)({
        selector: 'app-about',
        template: _about_component_html_ngResource__WEBPACK_IMPORTED_MODULE_0__,
        styles: [_about_component_scss_ngResource__WEBPACK_IMPORTED_MODULE_1__]
    })
], AboutComponent);



/***/ }),

/***/ 158:
/*!***************************************!*\
  !*** ./src/app/app-routing.module.ts ***!
  \***************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "AppRoutingModule": () => (/* binding */ AppRoutingModule)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @angular/core */ 2560);
/* harmony import */ var _angular_router__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @angular/router */ 124);
/* harmony import */ var _about_about_component__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./about/about.component */ 6698);




const routes = [
    {
        path: 'home',
        loadChildren: () => __webpack_require__.e(/*! import() */ "src_app_home_home_module_ts").then(__webpack_require__.bind(__webpack_require__, /*! ./home/home.module */ 3467)).then(m => m.HomePageModule)
    },
    {
        path: 'about',
        component: _about_about_component__WEBPACK_IMPORTED_MODULE_0__.AboutComponent
    },
    {
        path: '',
        redirectTo: 'home',
    },
    {
        path: '*',
        redirectTo: 'home',
    },
];
let AppRoutingModule = class AppRoutingModule {
};
AppRoutingModule = (0,tslib__WEBPACK_IMPORTED_MODULE_1__.__decorate)([
    (0,_angular_core__WEBPACK_IMPORTED_MODULE_2__.NgModule)({
        imports: [
            _angular_router__WEBPACK_IMPORTED_MODULE_3__.RouterModule.forRoot(routes, { preloadingStrategy: _angular_router__WEBPACK_IMPORTED_MODULE_3__.PreloadAllModules })
        ],
        exports: [_angular_router__WEBPACK_IMPORTED_MODULE_3__.RouterModule]
    })
], AppRoutingModule);



/***/ }),

/***/ 5041:
/*!**********************************!*\
  !*** ./src/app/app.component.ts ***!
  \**********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "AppComponent": () => (/* binding */ AppComponent)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _app_component_html_ngResource__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./app.component.html?ngResource */ 3383);
/* harmony import */ var _app_component_scss_ngResource__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./app.component.scss?ngResource */ 9259);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @angular/core */ 2560);




let AppComponent = class AppComponent {
    constructor() { }
};
AppComponent.ctorParameters = () => [];
AppComponent = (0,tslib__WEBPACK_IMPORTED_MODULE_2__.__decorate)([
    (0,_angular_core__WEBPACK_IMPORTED_MODULE_3__.Component)({
        selector: 'app-root',
        template: _app_component_html_ngResource__WEBPACK_IMPORTED_MODULE_0__,
        styles: [_app_component_scss_ngResource__WEBPACK_IMPORTED_MODULE_1__]
    })
], AppComponent);



/***/ }),

/***/ 6747:
/*!*******************************!*\
  !*** ./src/app/app.module.ts ***!
  \*******************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "AppModule": () => (/* binding */ AppModule)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! @angular/core */ 2560);
/* harmony import */ var _angular_platform_browser__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! @angular/platform-browser */ 4497);
/* harmony import */ var _angular_router__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(/*! @angular/router */ 124);
/* harmony import */ var _ionic_angular__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! @ionic/angular */ 3819);
/* harmony import */ var _app_component__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./app.component */ 5041);
/* harmony import */ var _app_routing_module__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./app-routing.module */ 158);
/* harmony import */ var _fortawesome_angular_fontawesome__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! @fortawesome/angular-fontawesome */ 9200);
/* harmony import */ var _fortawesome_free_solid_svg_icons__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @fortawesome/free-solid-svg-icons */ 655);
/* harmony import */ var _fortawesome_free_regular_svg_icons__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! @fortawesome/free-regular-svg-icons */ 9636);
/* harmony import */ var _fortawesome_free_brands_svg_icons__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! @fortawesome/free-brands-svg-icons */ 2186);
/* harmony import */ var _angular_youtube_player__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! @angular/youtube-player */ 2163);
/* harmony import */ var _angular_forms__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! @angular/forms */ 2508);
/* harmony import */ var _cognito_service__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./cognito.service */ 8139);
/* harmony import */ var _angular_common_http__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! @angular/common/http */ 8987);















let AppModule = class AppModule {
    constructor(library) {
        library.addIconPacks(_fortawesome_free_solid_svg_icons__WEBPACK_IMPORTED_MODULE_3__.fas, _fortawesome_free_brands_svg_icons__WEBPACK_IMPORTED_MODULE_4__.fab, _fortawesome_free_regular_svg_icons__WEBPACK_IMPORTED_MODULE_5__.far);
    }
};
AppModule.ctorParameters = () => [
    { type: _fortawesome_angular_fontawesome__WEBPACK_IMPORTED_MODULE_6__.FaIconLibrary }
];
AppModule = (0,tslib__WEBPACK_IMPORTED_MODULE_7__.__decorate)([
    (0,_angular_core__WEBPACK_IMPORTED_MODULE_8__.NgModule)({
        declarations: [_app_component__WEBPACK_IMPORTED_MODULE_0__.AppComponent],
        imports: [
            _angular_platform_browser__WEBPACK_IMPORTED_MODULE_9__.BrowserModule,
            _angular_common_http__WEBPACK_IMPORTED_MODULE_10__.HttpClientModule,
            _app_routing_module__WEBPACK_IMPORTED_MODULE_1__.AppRoutingModule,
            _fortawesome_angular_fontawesome__WEBPACK_IMPORTED_MODULE_6__.FontAwesomeModule,
            _angular_youtube_player__WEBPACK_IMPORTED_MODULE_11__.YouTubePlayerModule,
            _angular_forms__WEBPACK_IMPORTED_MODULE_12__.FormsModule,
            _ionic_angular__WEBPACK_IMPORTED_MODULE_13__.IonicModule.forRoot({
                mode: 'md'
            })
        ],
        providers: [{ provide: _angular_router__WEBPACK_IMPORTED_MODULE_14__.RouteReuseStrategy, useClass: _ionic_angular__WEBPACK_IMPORTED_MODULE_13__.IonicRouteStrategy },
            _cognito_service__WEBPACK_IMPORTED_MODULE_2__.CognitoService,
        ],
        bootstrap: [_app_component__WEBPACK_IMPORTED_MODULE_0__.AppComponent],
    })
], AppModule);



/***/ }),

/***/ 8139:
/*!************************************!*\
  !*** ./src/app/cognito.service.ts ***!
  \************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "CognitoService": () => (/* binding */ CognitoService)
/* harmony export */ });
/* harmony import */ var C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./node_modules/@babel/runtime/helpers/esm/asyncToGenerator.js */ 1670);
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! @angular/core */ 2560);
/* harmony import */ var amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! amazon-cognito-identity-js */ 3843);
/* harmony import */ var src_environments_environment__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! src/environments/environment */ 2340);
/* harmony import */ var _capacitor_storage__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @capacitor/storage */ 460);






let CognitoService = class CognitoService {
  constructor() {
    this.userPool = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoUserPool(src_environments_environment__WEBPACK_IMPORTED_MODULE_2__.environment.userPoolParams.COGNITO_POOL);
  }

  isLoggedIn() {
    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      const token = yield _capacitor_storage__WEBPACK_IMPORTED_MODULE_3__.Storage.get({
        key: 'token'
      });
      const bool = token.value !== null;
      return bool;
    })();
  }

  signUp(email, password) {
    return new Promise((resolved, reject) => {
      const userAttribute = [];
      userAttribute.push(new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoUserAttribute({
        Name: 'email',
        Value: email
      }));
      console.log(email, password);
      this.userPool.signUp(email, password, userAttribute, null, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolved(result);
        }
      });
    });
  }

  authenticate(email, password) {
    return new Promise((resolved, reject) => {
      const authDetails = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.AuthenticationDetails({
        Username: email,
        Password: password
      });
      const cognitoUser = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoUser({
        Username: email,
        Pool: this.userPool
      });
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: result => {
          resolved(result);
        },
        onFailure: err => {
          reject(err);
        }
      });
    });
  }

  signOut() {
    const thisUser = this.getCurrentUser();
    const cognitoUser = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoUser({
      Username: thisUser.username,
      Pool: this.userPool
    });
    cognitoUser.signOut();
  }

  getLoggedUser() {
    return new Promise((resolve, reject) => {
      const cognitoUser = this.userPool.getCurrentUser();

      if (cognitoUser != null) {
        cognitoUser.getSession((err, result) => {
          if (result) {
            console.log(result);
            resolve(result); //resolved(result.getIdToken().getJwtToken());
          } else {
            reject(err);
          }
        });
      }
    });
  }

  getRefreshToken() {
    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      const refreshToken = yield _capacitor_storage__WEBPACK_IMPORTED_MODULE_3__.Storage.get({
        key: 'refreshToken'
      });
      return refreshToken.value;
    })();
  }

  sendRestPasswordEmail(email) {
    return new Promise((resolved, reject) => {
      let userPool = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoUserPool(src_environments_environment__WEBPACK_IMPORTED_MODULE_2__.environment.userPoolParams.COGNITO_POOL);
      const cognitoUser = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoUser({
        Username: email,
        Pool: userPool
      });
      cognitoUser.forgotPassword({
        onSuccess: data => {
          // successfully initiated reset password request
          resolved(data);
        },
        onFailure: err => {
          reject(err);
        }
      });
    });
  }

  getCurrentUser() {
    var _this = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      return yield _this.userPool.getCurrentUser();
    })();
  }

  getToken() {
    var _this2 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      try {
        let token = yield _capacitor_storage__WEBPACK_IMPORTED_MODULE_3__.Storage.get({
          key: 'token'
        });
        const expiry = JSON.parse(atob(token.value.split('.')[1])).exp; // If JWT is not expired return token value else refresh using refresh token.

        if (Math.floor(new Date().getTime() / 1000) < expiry) {
          return token.value;
        } else {
          const email = yield _capacitor_storage__WEBPACK_IMPORTED_MODULE_3__.Storage.get({
            key: 'email'
          });
          yield _this2.refreshToken(email).then( /*#__PURE__*/function () {
            var _ref = (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* (newTokens) {
              const newIdToken = newTokens.idToken.getJwtToken();
              token = newIdToken;
              const refreshToken = newTokens.refreshToken.token;
              yield _capacitor_storage__WEBPACK_IMPORTED_MODULE_3__.Storage.set({
                key: 'token',
                value: newIdToken
              });
              yield _capacitor_storage__WEBPACK_IMPORTED_MODULE_3__.Storage.set({
                key: 'refreshToken',
                value: refreshToken
              });
            });

            return function (_x) {
              return _ref.apply(this, arguments);
            };
          }());
          const newToken = yield _capacitor_storage__WEBPACK_IMPORTED_MODULE_3__.Storage.get({
            key: 'token'
          });
          return newToken.value;
        }
      } catch (e) {
        _this2.signOut();
      }
    })();
  }

  refreshToken(email) {
    var _this3 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      const refreshToken = (yield _this3.getRefreshToken()).toString();
      return new Promise( /*#__PURE__*/function () {
        var _ref2 = (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* (resolved, reject) {
          const token = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoRefreshToken({
            RefreshToken: refreshToken
          });
          const userPool = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoUserPool(src_environments_environment__WEBPACK_IMPORTED_MODULE_2__.environment.userPoolParams.COGNITO_POOL);
          const cognitoUser = new amazon_cognito_identity_js__WEBPACK_IMPORTED_MODULE_1__.CognitoUser({
            Username: email,
            Pool: userPool
          });
          cognitoUser.refreshSession(token, (err, session) => {
            if (err) {
              reject(err);
            }

            resolved(session);
          });
        });

        return function (_x2, _x3) {
          return _ref2.apply(this, arguments);
        };
      }());
    })();
  }

};

CognitoService.ctorParameters = () => [];

CognitoService = (0,tslib__WEBPACK_IMPORTED_MODULE_4__.__decorate)([(0,_angular_core__WEBPACK_IMPORTED_MODULE_5__.Injectable)({
  providedIn: 'root'
})], CognitoService);


/***/ }),

/***/ 2340:
/*!*****************************************!*\
  !*** ./src/environments/environment.ts ***!
  \*****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "environment": () => (/* binding */ environment)
/* harmony export */ });
const environment = {
    production: true,
    backendServiceEndpoint: 'https://aud4wktno2.execute-api.us-west-2.amazonaws.com/Prod/',
    userPoolParams: {
        REGION: 'us-west-2',
        COGNITO_POOL: {
            UserPoolId: 'us-west-2_GYzCKjgDQ',
            ClientId: 'mr8r07airjo31j0q0pir1u955',
        },
    }
};


/***/ }),

/***/ 4431:
/*!*********************!*\
  !*** ./src/main.ts ***!
  \*********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @angular/core */ 2560);
/* harmony import */ var _angular_platform_browser_dynamic__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @angular/platform-browser-dynamic */ 6057);
/* harmony import */ var _app_app_module__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./app/app.module */ 6747);
/* harmony import */ var _environments_environment__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./environments/environment */ 2340);




if (_environments_environment__WEBPACK_IMPORTED_MODULE_1__.environment.production) {
    (0,_angular_core__WEBPACK_IMPORTED_MODULE_2__.enableProdMode)();
}
(0,_angular_platform_browser_dynamic__WEBPACK_IMPORTED_MODULE_3__.platformBrowserDynamic)().bootstrapModule(_app_app_module__WEBPACK_IMPORTED_MODULE_0__.AppModule)
    .catch(err => console.log(err));


/***/ }),

/***/ 863:
/*!******************************************************************************************************************************************!*\
  !*** ./node_modules/@ionic/core/dist/esm/ lazy ^\.\/.*\.entry\.js$ include: \.entry\.js$ exclude: \.system\.entry\.js$ namespace object ***!
  \******************************************************************************************************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

var map = {
	"./ion-accordion_2.entry.js": [
		79,
		"common",
		"node_modules_ionic_core_dist_esm_ion-accordion_2_entry_js"
	],
	"./ion-action-sheet.entry.js": [
		5593,
		"common",
		"node_modules_ionic_core_dist_esm_ion-action-sheet_entry_js"
	],
	"./ion-alert.entry.js": [
		3225,
		"common",
		"node_modules_ionic_core_dist_esm_ion-alert_entry_js"
	],
	"./ion-app_8.entry.js": [
		4812,
		"common",
		"node_modules_ionic_core_dist_esm_ion-app_8_entry_js"
	],
	"./ion-avatar_3.entry.js": [
		6655,
		"node_modules_ionic_core_dist_esm_ion-avatar_3_entry_js"
	],
	"./ion-back-button.entry.js": [
		4856,
		"common",
		"node_modules_ionic_core_dist_esm_ion-back-button_entry_js"
	],
	"./ion-backdrop.entry.js": [
		3059,
		"node_modules_ionic_core_dist_esm_ion-backdrop_entry_js"
	],
	"./ion-breadcrumb_2.entry.js": [
		8648,
		"common",
		"node_modules_ionic_core_dist_esm_ion-breadcrumb_2_entry_js"
	],
	"./ion-button_2.entry.js": [
		8308,
		"node_modules_ionic_core_dist_esm_ion-button_2_entry_js"
	],
	"./ion-card_5.entry.js": [
		4690,
		"node_modules_ionic_core_dist_esm_ion-card_5_entry_js"
	],
	"./ion-checkbox.entry.js": [
		4090,
		"node_modules_ionic_core_dist_esm_ion-checkbox_entry_js"
	],
	"./ion-chip.entry.js": [
		6214,
		"node_modules_ionic_core_dist_esm_ion-chip_entry_js"
	],
	"./ion-col_3.entry.js": [
		9447,
		"node_modules_ionic_core_dist_esm_ion-col_3_entry_js"
	],
	"./ion-datetime-button.entry.js": [
		7950,
		"default-node_modules_ionic_core_dist_esm_parse-26477881_js-node_modules_ionic_core_dist_esm_t-6bed99",
		"node_modules_ionic_core_dist_esm_ion-datetime-button_entry_js"
	],
	"./ion-datetime_3.entry.js": [
		9689,
		"default-node_modules_ionic_core_dist_esm_parse-26477881_js-node_modules_ionic_core_dist_esm_t-6bed99",
		"common",
		"node_modules_ionic_core_dist_esm_ion-datetime_3_entry_js"
	],
	"./ion-fab_3.entry.js": [
		8840,
		"common",
		"node_modules_ionic_core_dist_esm_ion-fab_3_entry_js"
	],
	"./ion-img.entry.js": [
		749,
		"node_modules_ionic_core_dist_esm_ion-img_entry_js"
	],
	"./ion-infinite-scroll_2.entry.js": [
		9667,
		"common",
		"node_modules_ionic_core_dist_esm_ion-infinite-scroll_2_entry_js"
	],
	"./ion-input.entry.js": [
		3288,
		"node_modules_ionic_core_dist_esm_ion-input_entry_js"
	],
	"./ion-item-option_3.entry.js": [
		5473,
		"common",
		"node_modules_ionic_core_dist_esm_ion-item-option_3_entry_js"
	],
	"./ion-item_8.entry.js": [
		3634,
		"common",
		"node_modules_ionic_core_dist_esm_ion-item_8_entry_js"
	],
	"./ion-loading.entry.js": [
		2855,
		"node_modules_ionic_core_dist_esm_ion-loading_entry_js"
	],
	"./ion-menu_3.entry.js": [
		495,
		"common",
		"node_modules_ionic_core_dist_esm_ion-menu_3_entry_js"
	],
	"./ion-modal.entry.js": [
		8737,
		"common",
		"node_modules_ionic_core_dist_esm_ion-modal_entry_js"
	],
	"./ion-nav_2.entry.js": [
		4933,
		"common",
		"node_modules_ionic_core_dist_esm_ion-nav_2_entry_js"
	],
	"./ion-picker-column-internal.entry.js": [
		4446,
		"common",
		"node_modules_ionic_core_dist_esm_ion-picker-column-internal_entry_js"
	],
	"./ion-picker-internal.entry.js": [
		2275,
		"node_modules_ionic_core_dist_esm_ion-picker-internal_entry_js"
	],
	"./ion-popover.entry.js": [
		8050,
		"common",
		"node_modules_ionic_core_dist_esm_ion-popover_entry_js"
	],
	"./ion-progress-bar.entry.js": [
		8994,
		"node_modules_ionic_core_dist_esm_ion-progress-bar_entry_js"
	],
	"./ion-radio_2.entry.js": [
		3592,
		"node_modules_ionic_core_dist_esm_ion-radio_2_entry_js"
	],
	"./ion-range.entry.js": [
		5454,
		"common",
		"node_modules_ionic_core_dist_esm_ion-range_entry_js"
	],
	"./ion-refresher_2.entry.js": [
		290,
		"common",
		"node_modules_ionic_core_dist_esm_ion-refresher_2_entry_js"
	],
	"./ion-reorder_2.entry.js": [
		2666,
		"common",
		"node_modules_ionic_core_dist_esm_ion-reorder_2_entry_js"
	],
	"./ion-ripple-effect.entry.js": [
		4816,
		"node_modules_ionic_core_dist_esm_ion-ripple-effect_entry_js"
	],
	"./ion-route_4.entry.js": [
		5534,
		"node_modules_ionic_core_dist_esm_ion-route_4_entry_js"
	],
	"./ion-searchbar.entry.js": [
		4902,
		"common",
		"node_modules_ionic_core_dist_esm_ion-searchbar_entry_js"
	],
	"./ion-segment_2.entry.js": [
		1938,
		"common",
		"node_modules_ionic_core_dist_esm_ion-segment_2_entry_js"
	],
	"./ion-select_3.entry.js": [
		8179,
		"node_modules_ionic_core_dist_esm_ion-select_3_entry_js"
	],
	"./ion-slide_2.entry.js": [
		668,
		"node_modules_ionic_core_dist_esm_ion-slide_2_entry_js"
	],
	"./ion-spinner.entry.js": [
		1624,
		"common",
		"node_modules_ionic_core_dist_esm_ion-spinner_entry_js"
	],
	"./ion-split-pane.entry.js": [
		9989,
		"node_modules_ionic_core_dist_esm_ion-split-pane_entry_js"
	],
	"./ion-tab-bar_2.entry.js": [
		8902,
		"common",
		"node_modules_ionic_core_dist_esm_ion-tab-bar_2_entry_js"
	],
	"./ion-tab_2.entry.js": [
		199,
		"common",
		"node_modules_ionic_core_dist_esm_ion-tab_2_entry_js"
	],
	"./ion-text.entry.js": [
		8395,
		"node_modules_ionic_core_dist_esm_ion-text_entry_js"
	],
	"./ion-textarea.entry.js": [
		6357,
		"node_modules_ionic_core_dist_esm_ion-textarea_entry_js"
	],
	"./ion-toast.entry.js": [
		8268,
		"node_modules_ionic_core_dist_esm_ion-toast_entry_js"
	],
	"./ion-toggle.entry.js": [
		5269,
		"common",
		"node_modules_ionic_core_dist_esm_ion-toggle_entry_js"
	],
	"./ion-virtual-scroll.entry.js": [
		2875,
		"node_modules_ionic_core_dist_esm_ion-virtual-scroll_entry_js"
	]
};
function webpackAsyncContext(req) {
	if(!__webpack_require__.o(map, req)) {
		return Promise.resolve().then(() => {
			var e = new Error("Cannot find module '" + req + "'");
			e.code = 'MODULE_NOT_FOUND';
			throw e;
		});
	}

	var ids = map[req], id = ids[0];
	return Promise.all(ids.slice(1).map(__webpack_require__.e)).then(() => {
		return __webpack_require__(id);
	});
}
webpackAsyncContext.keys = () => (Object.keys(map));
webpackAsyncContext.id = 863;
module.exports = webpackAsyncContext;

/***/ }),

/***/ 5724:
/*!*******************************************************!*\
  !*** ./src/app/about/about.component.scss?ngResource ***!
  \*******************************************************/
/***/ ((module) => {

"use strict";
module.exports = ".max-width {\n  max-width: 800px;\n}\n\n.header {\n  margin-top: 2em;\n  margin-bottom: 2em;\n}\n\n.article {\n  font-size: 1.2em;\n}\n\n@media (min-width: 600px) {\n  ion-card-content {\n    padding: 3em;\n  }\n}\n\nli,\np {\n  margin-bottom: 1em;\n}\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImFib3V0LmNvbXBvbmVudC5zY3NzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0VBQ0UsZ0JBQUE7QUFDRjs7QUFFQTtFQUNFLGVBQUE7RUFDQSxrQkFBQTtBQUNGOztBQUVBO0VBQ0UsZ0JBQUE7QUFDRjs7QUFFQTtFQUNFO0lBQ0UsWUFBQTtFQUNGO0FBQ0Y7O0FBRUE7O0VBRUUsa0JBQUE7QUFBRiIsImZpbGUiOiJhYm91dC5jb21wb25lbnQuc2NzcyIsInNvdXJjZXNDb250ZW50IjpbIi5tYXgtd2lkdGgge1xyXG4gIG1heC13aWR0aDogODAwcHg7XHJcbn1cclxuXHJcbi5oZWFkZXIge1xyXG4gIG1hcmdpbi10b3A6IDJlbTtcclxuICBtYXJnaW4tYm90dG9tOiAyZW07XHJcbn1cclxuXHJcbi5hcnRpY2xlIHtcclxuICBmb250LXNpemU6IDEuMmVtO1xyXG59XHJcblxyXG5AbWVkaWEgKG1pbi13aWR0aDogNjAwcHgpIHtcclxuICBpb24tY2FyZC1jb250ZW50IHtcclxuICAgIHBhZGRpbmc6IDNlbTtcclxuICB9XHJcbn1cclxuXHJcbmxpLFxyXG5wIHtcclxuICBtYXJnaW4tYm90dG9tOiAxZW07XHJcbn1cclxuIl19 */";

/***/ }),

/***/ 9259:
/*!***********************************************!*\
  !*** ./src/app/app.component.scss?ngResource ***!
  \***********************************************/
/***/ ((module) => {

"use strict";
module.exports = "\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IiIsImZpbGUiOiJhcHAuY29tcG9uZW50LnNjc3MifQ== */";

/***/ }),

/***/ 5133:
/*!*******************************************************!*\
  !*** ./src/app/about/about.component.html?ngResource ***!
  \*******************************************************/
/***/ ((module) => {

"use strict";
module.exports = "<ion-content>\n  <ion-grid>\n    <ion-row>\n      <ion-col size=\"12\" size-md=\"8\" offset-md=\"2\">\n        <ion-card>\n          <ion-card-content>\n            <ion-scroll>\n              <h1 class=\"ion-text-center header\">\n                What is the Pomodoro Technique?\n              </h1>\n              <div>\n                <p class=\"article\">\n                  the Pomodoro Technique is a simple yet effective time management method that can help you to increase\n                  focus\n                  and\n                  productivity. By breaking your work into shorter, more manageable chunks and taking regular breaks,\n                  you\n                  can\n                  improve\n                  your ability to concentrate, stay motivated, and get more done in less time.\n                </p>\n                <p class=\"article\">\n                  To use the Pomodoro Technique, you will need a timer (or pomodoro.fm) and a task or project that you\n                  want\n                  to\n                  complete.\n                  Start by setting the timer for 25 minutes and working on your task until the timer goes off. When the\n                  timer\n                  goes\n                  off,\n                  take a short break (5 minutes is a good length) to stretch, grab a drink of water, or do whatever you\n                  need\n                  to\n                  do\n                  to\n                  refresh yourself. After your break, set the timer for another 25 minutes and start working again.\n\n                  After four \"pomodoros\", take a longer break (15-30 minutes) to give your brain a chance to rest and\n                  recharge.\n                  You\n                  can\n                  then start the process again.\n                </p>\n                <p class=\"article\">\n                  One of the key principles of the Pomodoro Technique is that it helps you to focus on one task at a\n                  time.\n                  This\n                  is\n                  important because multitasking can actually reduce productivity by as much as 40%. When you use the\n                  Pomodoro\n                  Technique, you are giving your full attention to one task for a set period of time, which makes it\n                  more\n                  likely\n                  that\n                  you will complete that task in a shorter amount of time.\n                </p>\n                <p class=\"article\">\n                  Note: The 25 minute time intervals are just a starting point and you can adjust the timing as per your\n                  need.\n                  The\n                  key\n                  is to find a rhythm that works for you.\n                </p>\n              </div>\n              <h1 class=\"ion-text-center header\">\n                What are the benefits of the Pomodoro Technique?\n              </h1>\n\n              <ul class=\"article\">\n                <li>\n                  Increased focus: By breaking work into 25-minute intervals, the Pomodoro Technique helps to increase\n                  focus\n                  and\n                  concentration on a single task. This can lead to faster completion of the task and higher quality\n                  work.\n                  A\n                  study\n                  published in the Journal of Applied Psychology found that participants who used the Pomodoro Technique\n                  scored\n                  significantly higher on measures of attention and concentration compared to a control group.\n                </li>\n                <li>\n                  Reduced procrastination: Setting a timer for a specific amount of time helps to create a sense of\n                  urgency\n                  and\n                  accountability, which can reduce procrastination and increase motivation to get work done.\n                </li>\n                <li>\n                  Improved time management: By breaking work into shorter intervals, the Pomodoro Technique helps to\n                  manage\n                  time\n                  more\n                  effectively and prioritize tasks more efficiently.\n                </li>\n                <li>\n                  Reduced multitasking: The Pomodoro Technique encourages single-tasking, which helps to reduce\n                  multitasking,\n                  which\n                  in\n                  turn can increase productivity by up to 40%.\n                </li>\n                <li>\n                  Better mental clarity: Regular breaks throughout the workday help to refresh the mind and improve\n                  mental\n                  clarity,\n                  leading to better decision making and problem-solving. A study published in the International Journal\n                  of\n                  Humanities\n                  and Social Science Research found that taking regular breaks throughout the workday, as the Pomodoro\n                  Technique\n                  encourages, improved mental\n                  clarity and decision making.\n                </li>\n                <li>\n                  Reduced stress and burnout: By managing time more effectively and taking regular breaks, the Pomodoro\n                  Technique\n                  can\n                  help to reduce stress and prevent burnout. A study published in the Journal of Occupational Health\n                  Psychology\n                  found\n                  that the Pomodoro Technique helped to reduce stress and prevent burnout in a sample of university\n                  students.\n                </li>\n              </ul>\n\n              <h1 class=\"ion-text-center header\">\n                Why should I listen to music while performing Pomodoros?\n              </h1>\n              <ul class=\"article\">\n                <li>\n                  Increased motivation: Music can help to increase motivation and energy levels, which can make it\n                  easier\n                  to\n                  stay\n                  focused on a task for an extended period of time.\n                </li>\n                <li>\n                  Reduced stress: Listening to music has been shown to reduce stress and anxiety, which can make it\n                  easier\n                  to\n                  focus\n                  on\n                  a\n                  task and improve productivity.\n                </li>\n                <li>\n                  Improved mood: Music has been shown to have a positive effect on mood, which can help to reduce\n                  feelings\n                  of\n                  frustration and make it easier to stay focused on a task.\n                </li>\n\n                <li>\n                  Better concentration: Music can help to reduce distractions and improve concentration, which can make\n                  it\n                  easier\n                  to\n                  stay focused on a task for an extended period of time. A study published in the journal \"Frontiers in\n                  Human\n                  Neuroscience\" found that listening to music can improve focus, attention, and cognitive control. The\n                  study\n                  found\n                  that music can help to reduce distractions and improve cognitive performance, and that it can be\n                  especially\n                  beneficial\n                  for tasks that require a high degree of focus and attention.\n                </li>\n\n              </ul>\n\n              <h1 class=\"ion-text-center header\">\n                What is the inspiration behing Pomodoro.FM\n              </h1>\n\n              <p class=\"article\">\n                Hi all, My name is Zach and I'm the developer behind Pomodoro.FM. I'm extremely passionate about\n                personal\n                productivity, it has allowed me to find success in my life despite having many failures early on. I know\n                it\n                sounds\n                dramatic, but using the pomodoro method, especially with music has changed my life. It is a tool that\n                enables\n                me\n                to\n                fully focus, something I severly struggled with for many years. I find that using the Pomodoro method,\n                even\n                for\n                just\n                3 rounds a day, greatly increases my productivity, my mood and my sense of self worth.\n                I hope that this tool helps you all to be more productive and brings you the sense of peace and\n                happiness\n                that\n                it\n                has brought me.\n              </p>\n\n              <div class=\"ion-text-center\">\n                <a href=\"./home\" class=\"ion-text-center\">\n                  Go to the Timer\n                </a>\n              </div>\n\n            </ion-scroll>\n          </ion-card-content>\n        </ion-card>\n      </ion-col>\n    </ion-row>\n  </ion-grid>\n</ion-content>\n";

/***/ }),

/***/ 3383:
/*!***********************************************!*\
  !*** ./src/app/app.component.html?ngResource ***!
  \***********************************************/
/***/ ((module) => {

"use strict";
module.exports = "<ion-app>\r\n  <ion-router-outlet></ion-router-outlet>\r\n</ion-app>\r\n";

/***/ }),

/***/ 6249:
/*!************************!*\
  !*** crypto (ignored) ***!
  \************************/
/***/ (() => {

/* (ignored) */

/***/ })

},
/******/ __webpack_require__ => { // webpackRuntimeModules
/******/ var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
/******/ __webpack_require__.O(0, ["vendor"], () => (__webpack_exec__(4431)));
/******/ var __webpack_exports__ = __webpack_require__.O();
/******/ }
]);
//# sourceMappingURL=main.js.map