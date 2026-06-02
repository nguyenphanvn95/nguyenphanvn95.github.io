"use strict";
(self["webpackChunkapp"] = self["webpackChunkapp"] || []).push([["src_app_home_home_module_ts"],{

/***/ 2003:
/*!*********************************************!*\
  !*** ./src/app/home/home-routing.module.ts ***!
  \*********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "HomePageRoutingModule": () => (/* binding */ HomePageRoutingModule)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @angular/core */ 2560);
/* harmony import */ var _angular_router__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @angular/router */ 124);
/* harmony import */ var _home_page__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./home.page */ 2267);




const routes = [
    {
        path: '',
        component: _home_page__WEBPACK_IMPORTED_MODULE_0__.HomePage,
    }
];
let HomePageRoutingModule = class HomePageRoutingModule {
};
HomePageRoutingModule = (0,tslib__WEBPACK_IMPORTED_MODULE_1__.__decorate)([
    (0,_angular_core__WEBPACK_IMPORTED_MODULE_2__.NgModule)({
        imports: [_angular_router__WEBPACK_IMPORTED_MODULE_3__.RouterModule.forChild(routes)],
        exports: [_angular_router__WEBPACK_IMPORTED_MODULE_3__.RouterModule]
    })
], HomePageRoutingModule);



/***/ }),

/***/ 3467:
/*!*************************************!*\
  !*** ./src/app/home/home.module.ts ***!
  \*************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "HomePageModule": () => (/* binding */ HomePageModule)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @angular/core */ 2560);
/* harmony import */ var _angular_common__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! @angular/common */ 4666);
/* harmony import */ var _ionic_angular__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! @ionic/angular */ 3819);
/* harmony import */ var _angular_forms__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! @angular/forms */ 2508);
/* harmony import */ var _home_page__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./home.page */ 2267);
/* harmony import */ var _angular_youtube_player__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! @angular/youtube-player */ 2163);
/* harmony import */ var _home_routing_module__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./home-routing.module */ 2003);
/* harmony import */ var _fortawesome_angular_fontawesome__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! @fortawesome/angular-fontawesome */ 9200);









let HomePageModule = class HomePageModule {
};
HomePageModule = (0,tslib__WEBPACK_IMPORTED_MODULE_2__.__decorate)([
    (0,_angular_core__WEBPACK_IMPORTED_MODULE_3__.NgModule)({
        imports: [
            _angular_common__WEBPACK_IMPORTED_MODULE_4__.CommonModule,
            _angular_forms__WEBPACK_IMPORTED_MODULE_5__.FormsModule,
            _angular_forms__WEBPACK_IMPORTED_MODULE_5__.ReactiveFormsModule,
            _ionic_angular__WEBPACK_IMPORTED_MODULE_6__.IonicModule,
            _fortawesome_angular_fontawesome__WEBPACK_IMPORTED_MODULE_7__.FontAwesomeModule,
            _home_routing_module__WEBPACK_IMPORTED_MODULE_1__.HomePageRoutingModule,
            _angular_youtube_player__WEBPACK_IMPORTED_MODULE_8__.YouTubePlayerModule
        ],
        declarations: [_home_page__WEBPACK_IMPORTED_MODULE_0__.HomePage],
        providers: []
    })
], HomePageModule);



/***/ }),

/***/ 2267:
/*!***********************************!*\
  !*** ./src/app/home/home.page.ts ***!
  \***********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "HomePage": () => (/* binding */ HomePage)
/* harmony export */ });
/* harmony import */ var C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./node_modules/@babel/runtime/helpers/esm/asyncToGenerator.js */ 1670);
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _home_page_html_ngResource__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./home.page.html?ngResource */ 3853);
/* harmony import */ var _home_page_scss_ngResource__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./home.page.scss?ngResource */ 1020);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! @angular/core */ 2560);
/* harmony import */ var _angular_forms__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! @angular/forms */ 2508);
/* harmony import */ var _capacitor_community_native_audio__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @capacitor-community/native-audio */ 2087);
/* harmony import */ var _ionic_angular__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! @ionic/angular */ 3819);
/* harmony import */ var _cognito_service__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../cognito.service */ 8139);
/* harmony import */ var _capacitor_storage__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! @capacitor/storage */ 460);
/* harmony import */ var _yt_service__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../yt.service */ 8216);
/* harmony import */ var _angular_router__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! @angular/router */ 124);













let HomePage = class HomePage {
  constructor(toastController, cognitoService, ytService, router) {
    this.toastController = toastController;
    this.cognitoService = cognitoService;
    this.ytService = ytService;
    this.router = router; // To define if the state is in a timer or break

    this.break = false;
    this.authLoading = false;
    this.resetPassword = false; // Timer duration in minutes

    this.sessionTime = 25; // Break time in minutes

    this.shortBreakTime = 5;
    this.longBreakTime = 15; // Long break on

    this.longBreakOn = false; // Long break every X sessions

    this.longBreakInterval = 3;
    this.timerActive = false; // mode of music, either youtube or spotify

    this.musicMode = 'youtube';
    this.musicPlaying = false; // URL for youtube music

    this.youtubeVidId = 'jfKfPfyJRdk';
    this.breakYouTubeVidId = '0QKdqm5TX6c';
    this.iFrameId = 'jfKfPfyJRdk';
    this.youtubeVids = []; // Stores completed sessions;

    this.sessionsCompleted = 0;
    this.signInMode = 'signIn';
    this.isFullScreen = false;
    this.delay = /*#__PURE__*/(0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* (ms = 1000) {
      return new Promise(resolve => setTimeout(resolve, ms));
    });
  }

  ngOnInit() {
    var _this = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      _this.docElement = document.documentElement;
      _this.youtubeForm = new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormGroup({
        id: new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormControl('', _angular_forms__WEBPACK_IMPORTED_MODULE_7__.Validators.required),
        name: new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormControl('', _angular_forms__WEBPACK_IMPORTED_MODULE_7__.Validators.required)
      });
      _this.loginForm = new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormGroup({
        email: new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormControl('', _angular_forms__WEBPACK_IMPORTED_MODULE_7__.Validators.required),
        password: new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormControl('', _angular_forms__WEBPACK_IMPORTED_MODULE_7__.Validators.required)
      });
      _this.signupForm = new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormGroup({
        email: new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormControl('', _angular_forms__WEBPACK_IMPORTED_MODULE_7__.Validators.required),
        password: new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormControl('', _angular_forms__WEBPACK_IMPORTED_MODULE_7__.Validators.required)
      });
      _this.resetPasswordForm = new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormGroup({
        email: new _angular_forms__WEBPACK_IMPORTED_MODULE_7__.FormControl('', [_angular_forms__WEBPACK_IMPORTED_MODULE_7__.Validators.required])
      }); // Load iFrame youtube api.

      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag); // Set and change display time.

      _this.timeLeft = _this.sessionTime * 60;

      _this.changeTime();

      _capacitor_community_native_audio__WEBPACK_IMPORTED_MODULE_3__.NativeAudio.preload({
        assetId: 'ding',
        assetPath: '../../assets/mp3/start-ding.mp3',
        audioChannelNum: 1,
        isUrl: false
      });
      _this.loggedIn = yield _this.cognitoService.isLoggedIn();

      if (_this.loggedIn) {
        const thisUser = yield _this.cognitoService.getLoggedUser();
        _this.user = thisUser.getIdToken().payload.email.split('@')[0];
      }

      _this.getYtVideos();
    })();
  }

  changeTime() {
    this.min = Math.floor(this.timeLeft / 60);
    this.sec = Math.floor(this.timeLeft % 60);
  }

  toggleTimer() {
    if (!this.timerActive) {
      // If first start play ding sound
      if (this.timeLeft === this.shortBreakTime * 60) {
        this.playDingSound();
        this.countDown(true);
      } else {
        this.countDown(false);
      }

      this.playMusic();
    } else {
      this.pauseTimer();
      this.stopMusic();
    }

    this.timerActive = !this.timerActive;
  }

  pauseTimer() {
    clearInterval(this.interval);
  }

  resetTimer() {
    if (!this.break) {
      this.timeLeft = this.sessionTime * 60;
    } else {
      this.timeLeft = this.shortBreakTime * 60;
    }

    this.changeTime();
  }

  playMusic() {
    this.player.setVolume(0);
    this.player.playVideo();
    this.fadeInYoutubeVolume();
    this.musicPlaying = true;
  }

  fadeInYoutubeVolume() {
    var _this2 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      for (let x = 0; x < 10; x++) {
        _this2.player.setVolume(x * 10);

        yield _this2.delay(1000);
      }
    })();
  }

  fadeOutYoutubeVolume() {
    var _this3 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      for (let x = 10; x > 0; x--) {
        _this3.player.setVolume(x * 10);

        console.log(x * 10);
        yield _this3.delay(1000);
      }
    })();
  }

  stopMusic() {
    this.player.pauseVideo();
    this.musicPlaying = false;
  }

  playDingSound() {
    _capacitor_community_native_audio__WEBPACK_IMPORTED_MODULE_3__.NativeAudio.play({
      assetId: 'ding',
      time: 1
    });
  }

  countDown(switchModes) {
    if (switchModes) {
      this.break = !this.break;
    }

    this.interval = setInterval(() => {
      this.timeLeft--;
      this.changeTime();

      if (this.timeLeft === 0 || this.timeLeft < 1) {
        clearInterval(this.interval);
        this.switchModes();
      }
    }, 1000);
  }

  onReady(player) {
    console.log(player);
    this.player = player.target;
  } // Switch between pomodo and break


  switchModes() {
    this.playDingSound();

    if (!this.break) {
      this.sessionsCompleted++;
      this.timeLeft = this.shortBreakTime * 60;
      this.stopMusic();
      this.changeYouTubeId(this.breakYouTubeVidId);
      this.playMusic();
    } else {
      this.timeLeft = this.sessionTime * 60;
      this.stopMusic();
      console.log(this.youtubeVidId);
      this.changeYouTubeId(this.youtubeVidId);
      this.playMusic();
    }

    this.countDown(true);
  }

  closeSettingModal() {
    this.timeLeft = this.sessionTime * 60;
    this.changeTime();
    this.timerModal.dismiss(null, 'cancel');
  }

  counter(i) {
    return new Array(i);
  }

  changeYouTubeId(videoId) {
    this.player.loadVideoById(videoId);
  }

  saveYoutubeVideo() {
    var _this4 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      // get id from video.
      const paramString = _this4.youtubeForm.get('id').value.split('?')[1];

      const queryString = new URLSearchParams(paramString);
      const id = queryString.get('v');

      const name = _this4.youtubeForm.get('name').value;

      _this4.youtubeVids.push({
        name: name,
        id: id
      });

      _this4.youtubeForm.reset();

      _this4.youtubeForm.get('id').reset();

      if (_this4.loggedIn) {
        const thisUser = yield _this4.cognitoService.getLoggedUser();
        (yield _this4.ytService.createYT(id, name)).subscribe(data => {
          console.log(data);
        }, error => console.log(error));
      } else {
        _this4.presentToast('Sign in to save your videos between sessions.');
      }
    })();
  }

  setVideo($event) {
    this.youtubeVidId = $event.detail.value;
    this.changeYouTubeId(this.youtubeVidId);

    if (!this.musicPlaying) {
      this.player.pauseVideo();
    }
  }

  getYtVideos() {
    var _this5 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      (yield _this5.ytService.getAllYT()).subscribe(data => {
        console.log(data.Items);
        data.Items.forEach(el => {
          console.log(el);

          _this5.youtubeVids.push({
            name: el.name.S,
            id: el.url.S
          });
        });
      }, error => console.log(error));
    })();
  }

  toggleFullScreen() {
    if (!this.isFullScreen) {
      this.docElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }

    this.isFullScreen = !this.isFullScreen;
  }

  signInSegmentChanged($event) {
    this.signInMode = $event.detail.value;
  }

  musicSegmentChanged($event) {
    this.musicMode = $event.detail.value;
  }

  signIn() {
    this.authLoading = true;
    const email = this.loginForm.get('email').value;
    const password = this.loginForm.get('password').value;
    this.cognitoService.authenticate(email, password).then(res => {
      console.log(res);
      this.authLoading = false;
      const token = res.idToken.getJwtToken();
      const refreshToken = res.refreshToken.token;
      _capacitor_storage__WEBPACK_IMPORTED_MODULE_5__.Storage.set({
        key: 'token',
        value: token
      });
      _capacitor_storage__WEBPACK_IMPORTED_MODULE_5__.Storage.set({
        key: 'refreshToken',
        value: refreshToken
      });
      this.loggedIn = true;
      this.getYtVideos();
    }, err => {
      console.log(err);
      this.authLoading = false;
      this.presentToast(err); //this.loading = false;
    });
  }

  signUp() {
    this.authLoading = true;
    const email = this.signupForm.get('email').value;
    const password = this.signupForm.get('password').value;
    console.log(email, password);
    this.cognitoService.signUp(email, password).then(res => {
      console.log(res);
      this.authLoading = false;
      this.cognitoService.authenticate(email, password).then(nestedRes => {
        console.log(nestedRes);
        this.authLoading = false;
        const token = nestedRes.idToken.getJwtToken();
        const refreshToken = nestedRes.refreshToken.token;
        _capacitor_storage__WEBPACK_IMPORTED_MODULE_5__.Storage.set({
          key: 'token',
          value: token
        });
        _capacitor_storage__WEBPACK_IMPORTED_MODULE_5__.Storage.set({
          key: 'refreshToken',
          value: refreshToken
        });
        this.loggedIn = true;
      }, err => {
        console.log(err);
        this.authLoading = false;
        this.presentToast(err); //this.loading = false;
      });
    }, err => {
      console.log(err);
      this.authLoading = false;
      this.presentToast(err); //this.loading = false;
    });
  }

  sendResetPasswordEmail() {
    var _this6 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      _this6.authLoading = true;

      _this6.cognitoService.sendRestPasswordEmail(_this6.resetPasswordForm.value.email).then(res => {
        console.log(res);

        _this6.presentToast('A password reset email has been sent.');
      }, err => {
        console.log(err);
        _this6.authLoading = false;

        _this6.presentToast(err.message);
      });
    })();
  }

  logout() {
    var _this7 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      yield _capacitor_storage__WEBPACK_IMPORTED_MODULE_5__.Storage.clear();
      yield _this7.cognitoService.signOut();
      _this7.loggedIn = false;
    })();
  }

  presentToast(message) {
    var _this8 = this;

    return (0,C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__["default"])(function* () {
      const toast = yield _this8.toastController.create({
        message: message,
        duration: 3000,
        position: 'bottom'
      });
      yield toast.present();
    })();
  }

  onWillDismiss($event) {
    console.log($event);
  }

};

HomePage.ctorParameters = () => [{
  type: _ionic_angular__WEBPACK_IMPORTED_MODULE_8__.ToastController
}, {
  type: _cognito_service__WEBPACK_IMPORTED_MODULE_4__.CognitoService
}, {
  type: _yt_service__WEBPACK_IMPORTED_MODULE_6__.YtService
}, {
  type: _angular_router__WEBPACK_IMPORTED_MODULE_9__.Router
}];

HomePage.propDecorators = {
  timerModal: [{
    type: _angular_core__WEBPACK_IMPORTED_MODULE_10__.ViewChild,
    args: [_ionic_angular__WEBPACK_IMPORTED_MODULE_8__.IonModal]
  }],
  profileModal: [{
    type: _angular_core__WEBPACK_IMPORTED_MODULE_10__.ViewChild,
    args: [_ionic_angular__WEBPACK_IMPORTED_MODULE_8__.IonModal]
  }],
  youTubeModal: [{
    type: _angular_core__WEBPACK_IMPORTED_MODULE_10__.ViewChild,
    args: [_ionic_angular__WEBPACK_IMPORTED_MODULE_8__.IonModal]
  }]
};
HomePage = (0,tslib__WEBPACK_IMPORTED_MODULE_11__.__decorate)([(0,_angular_core__WEBPACK_IMPORTED_MODULE_10__.Component)({
  selector: 'app-home',
  template: _home_page_html_ngResource__WEBPACK_IMPORTED_MODULE_1__,
  styles: [_home_page_scss_ngResource__WEBPACK_IMPORTED_MODULE_2__]
})], HomePage);


/***/ }),

/***/ 8216:
/*!*******************************!*\
  !*** ./src/app/yt.service.ts ***!
  \*******************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "YtService": () => (/* binding */ YtService)
/* harmony export */ });
/* harmony import */ var C_Users_zwright_pomodoro_app_node_modules_babel_runtime_helpers_esm_asyncToGenerator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./node_modules/@babel/runtime/helpers/esm/asyncToGenerator.js */ 1670);
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! tslib */ 4929);
/* harmony import */ var _angular_core__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! @angular/core */ 2560);
/* harmony import */ var _cognito_service__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./cognito.service */ 8139);
/* harmony import */ var _angular_common_http__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @angular/common/http */ 8987);
/* harmony import */ var src_environments_environment__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! src/environments/environment */ 2340);






let YtService = class YtService {
  constructor(http, cognitoService) {
    this.http = http;
    this.cognitoService = cognitoService;
  }

  getAllYT() {
    return Promise.resolve({
      subscribe: next => {
        next({
          Items: []
        });
        return {
          unsubscribe() {}
        };
      }
    });
  }

  createYT(url, name) {
    return Promise.resolve({
      subscribe: next => {
        next({
          ok: true,
          url,
          name
        });
        return {
          unsubscribe() {}
        };
      }
    });
  }

};

YtService.ctorParameters = () => [{
  type: _angular_common_http__WEBPACK_IMPORTED_MODULE_3__.HttpClient
}, {
  type: _cognito_service__WEBPACK_IMPORTED_MODULE_1__.CognitoService
}];

YtService = (0,tslib__WEBPACK_IMPORTED_MODULE_4__.__decorate)([(0,_angular_core__WEBPACK_IMPORTED_MODULE_5__.Injectable)({
  providedIn: 'root'
})], YtService);


/***/ }),

/***/ 5466:
/*!********************************************************************************!*\
  !*** ./node_modules/@capacitor-community/native-audio/dist/esm/definitions.js ***!
  \********************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);


/***/ }),

/***/ 2087:
/*!**************************************************************************!*\
  !*** ./node_modules/@capacitor-community/native-audio/dist/esm/index.js ***!
  \**************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "NativeAudio": () => (/* binding */ NativeAudio)
/* harmony export */ });
/* harmony import */ var _capacitor_core__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @capacitor/core */ 5099);
/* harmony import */ var _definitions__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./definitions */ 5466);

const NativeAudio = (0,_capacitor_core__WEBPACK_IMPORTED_MODULE_0__.registerPlugin)('NativeAudio', {
  web: () => __webpack_require__.e(/*! import() */ "node_modules_capacitor-community_native-audio_dist_esm_web_js").then(__webpack_require__.bind(__webpack_require__, /*! ./web */ 7800)).then(m => new m.NativeAudioWeb())
});



/***/ }),

/***/ 1020:
/*!************************************************!*\
  !*** ./src/app/home/home.page.scss?ngResource ***!
  \************************************************/
/***/ ((module) => {

module.exports = "#container {\n  text-align: center;\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 50%;\n  transform: translateY(-50%);\n  font-family: \"Bebas Neue\", sans-serif;\n}\n\n.control-bar {\n  margin-top: 50px;\n}\n\n.rounded-button {\n  --border-radius: 5px;\n}\n\n.flex-col {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n}\n\nion-row {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n@media (prefers-color-scheme: dark) {\n  .timer-box {\n    color: #b7b7b7;\n    background-color: #151515;\n    border-radius: 0.1em;\n    min-width: 1.5em;\n    margin: 0.05em;\n  }\n}\n\n@media (prefers-color-scheme: light) {\n  .timer-box {\n    color: #151515;\n    background-color: #eeeeee;\n    border-radius: 0.1em;\n    min-width: 1.5em;\n    margin: 0.05em;\n  }\n}\n\n#container {\n  font-size: 7em;\n}\n\n.timer-row {\n  position: relative;\n}\n\n.line {\n  display: inline-block;\n  left: 0;\n  height: 4px;\n  background: var(--ion-background-color);\n  content: \"\";\n  width: 100%;\n  position: absolute;\n  top: 47.5%;\n}\n\n@media (min-width: 600px) {\n  #container {\n    font-size: 9em;\n  }\n  .control-bar {\n    margin-top: 50px;\n  }\n}\n\n@media (min-width: 800px) and (min-height: 600px) {\n  #container {\n    font-size: 14em;\n  }\n  .control-bar {\n    margin-top: 100px;\n  }\n}\n\n#youtube-audio {\n  max-height: 10px;\n  max-width: 10px;\n}\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImhvbWUucGFnZS5zY3NzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0VBQ0Usa0JBQUE7RUFDQSxrQkFBQTtFQUNBLE9BQUE7RUFDQSxRQUFBO0VBQ0EsUUFBQTtFQUNBLDJCQUFBO0VBQ0EscUNBQUE7QUFDRjs7QUFFQTtFQUNFLGdCQUFBO0FBQ0Y7O0FBRUE7RUFDRSxvQkFBQTtBQUNGOztBQUVBO0VBQ0UsYUFBQTtFQUNBLHVCQUFBO0VBQ0EsbUJBQUE7QUFDRjs7QUFFQTtFQUNFLGFBQUE7RUFDQSxtQkFBQTtFQUNBLHVCQUFBO0FBQ0Y7O0FBSUE7RUFDRTtJQUNFLGNBQUE7SUFDQSx5QkFBQTtJQUNBLG9CQUFBO0lBQ0EsZ0JBQUE7SUFDQSxjQUFBO0VBREY7QUFDRjs7QUFJQTtFQUNFO0lBQ0UsY0FBQTtJQUNBLHlCQUFBO0lBQ0Esb0JBQUE7SUFDQSxnQkFBQTtJQUNBLGNBQUE7RUFGRjtBQUNGOztBQUtBO0VBQ0UsY0FBQTtBQUhGOztBQU1BO0VBQ0Usa0JBQUE7QUFIRjs7QUFNQTtFQUNFLHFCQUFBO0VBQ0EsT0FBQTtFQUNBLFdBQUE7RUFDQSx1Q0FBQTtFQUNBLFdBQUE7RUFDQSxXQUFBO0VBQ0Esa0JBQUE7RUFDQSxVQUFBO0FBSEY7O0FBT0E7RUFDRTtJQUNFLGNBQUE7RUFKRjtFQU9BO0lBQ0UsZ0JBQUE7RUFMRjtBQUNGOztBQVNBO0VBQ0U7SUFDRSxlQUFBO0VBUEY7RUFVQTtJQUNFLGlCQUFBO0VBUkY7QUFDRjs7QUFXQTtFQUNFLGdCQUFBO0VBQ0EsZUFBQTtBQVRGIiwiZmlsZSI6ImhvbWUucGFnZS5zY3NzIiwic291cmNlc0NvbnRlbnQiOlsiI2NvbnRhaW5lciB7XHJcbiAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICBsZWZ0OiAwO1xyXG4gIHJpZ2h0OiAwO1xyXG4gIHRvcDogNTAlO1xyXG4gIHRyYW5zZm9ybTogdHJhbnNsYXRlWSgtNTAlKTtcclxuICBmb250LWZhbWlseTogXCJCZWJhcyBOZXVlXCIsIHNhbnMtc2VyaWY7XHJcbn1cclxuXHJcbi5jb250cm9sLWJhciB7XHJcbiAgbWFyZ2luLXRvcDogNTBweDtcclxufVxyXG5cclxuLnJvdW5kZWQtYnV0dG9uIHtcclxuICAtLWJvcmRlci1yYWRpdXM6IDVweDtcclxufVxyXG5cclxuLmZsZXgtY29sIHtcclxuICBkaXNwbGF5OiBmbGV4O1xyXG4gIGp1c3RpZnktY29udGVudDogY2VudGVyO1xyXG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbn1cclxuXHJcbmlvbi1yb3cge1xyXG4gIGRpc3BsYXk6IGZsZXg7XHJcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjtcclxufVxyXG5cclxuXHJcblxyXG5AbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOiBkYXJrKSB7XHJcbiAgLnRpbWVyLWJveCB7XHJcbiAgICBjb2xvcjogI2I3YjdiNztcclxuICAgIGJhY2tncm91bmQtY29sb3I6ICMxNTE1MTU7XHJcbiAgICBib3JkZXItcmFkaXVzOiAwLjFlbTtcclxuICAgIG1pbi13aWR0aDogMS41ZW07XHJcbiAgICBtYXJnaW46IDAuMDVlbTtcclxuICB9XHJcbn1cclxuXHJcbkBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGxpZ2h0KSB7XHJcbiAgLnRpbWVyLWJveCB7XHJcbiAgICBjb2xvcjogIzE1MTUxNTtcclxuICAgIGJhY2tncm91bmQtY29sb3I6ICNlZWVlZWU7XHJcbiAgICBib3JkZXItcmFkaXVzOiAwLjFlbTtcclxuICAgIG1pbi13aWR0aDogMS41ZW07XHJcbiAgICBtYXJnaW46IDAuMDVlbTtcclxuICB9XHJcbn1cclxuXHJcbiNjb250YWluZXIge1xyXG4gIGZvbnQtc2l6ZTogN2VtO1xyXG59XHJcblxyXG4udGltZXItcm93IHtcclxuICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbn1cclxuXHJcbi5saW5lIHtcclxuICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XHJcbiAgbGVmdDogMDtcclxuICBoZWlnaHQ6NHB4O1xyXG4gIGJhY2tncm91bmQ6IHZhcigtLWlvbi1iYWNrZ3JvdW5kLWNvbG9yKTtcclxuICBjb250ZW50OiBcIlwiO1xyXG4gIHdpZHRoOiAxMDAlO1xyXG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICB0b3A6IDQ3LjUlXHJcbn1cclxuXHJcblxyXG5AbWVkaWEgKG1pbi13aWR0aDogNjAwcHgpIHtcclxuICAjY29udGFpbmVyIHtcclxuICAgIGZvbnQtc2l6ZTogOWVtO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRyb2wtYmFyIHtcclxuICAgIG1hcmdpbi10b3A6IDUwcHg7XHJcbiAgfVxyXG5cclxufVxyXG5cclxuQG1lZGlhIChtaW4td2lkdGg6IDgwMHB4KSBhbmQgKG1pbi1oZWlnaHQ6IDYwMHB4KSB7XHJcbiAgI2NvbnRhaW5lciB7XHJcbiAgICBmb250LXNpemU6IDE0ZW07XHJcbiAgfVxyXG5cclxuICAuY29udHJvbC1iYXIge1xyXG4gICAgbWFyZ2luLXRvcDogMTAwcHg7XHJcbiAgfVxyXG59XHJcblxyXG4jeW91dHViZS1hdWRpbyB7XHJcbiAgbWF4LWhlaWdodDogMTBweDtcclxuICBtYXgtd2lkdGg6IDEwcHg7XHJcbn1cclxuIl19 */";

/***/ }),

/***/ 3853:
/*!************************************************!*\
  !*** ./src/app/home/home.page.html?ngResource ***!
  \************************************************/
/***/ ((module) => {

module.exports = "<ion-content [fullscreen]=\"true\">\r\n  <ion-fab vertical=\"top\" horizontal=\"end\">\r\n    <ion-fab-button size=\"small\" color=\"light\" (click)=\"toggleFullScreen()\">\r\n      <ion-icon *ngIf=\"!isFullScreen\" name=\"expand\"></ion-icon>\r\n      <ion-icon *ngIf=\"isFullScreen\" name=\"contract\"></ion-icon>\r\n    </ion-fab-button>\r\n  </ion-fab>\r\n  <div id=\"container\">\r\n    <div class=\"timer\">\r\n      <ion-grid>\r\n        <ion-row class=\"ion-justify-content-center\">\r\n          <ion-row class=\"timer-row\">\r\n            <div class=\"line\"></div>\r\n            <div class=\"timer-box\">{{min | number:'2.0'}}</div>\r\n            <div class=\"timer-box\">{{sec | number:'2.0'}}</div>\r\n          </ion-row>\r\n          <div #clock></div>\r\n        </ion-row>\r\n        <ion-row class=\"ion-justify-content-center ion-margin\">\r\n          <ng-container *ngFor=\"let n of counter(sessionsCompleted)\">\r\n            <ion-icon name=\"flame-outline\" size=\"large\">\r\n            </ion-icon>\r\n          </ng-container>\r\n        </ion-row>\r\n      </ion-grid>\r\n    </div>\r\n    <!-- fab placed to the bottom end -->\r\n    <div class=\"control-bar\">\r\n      <ion-grid>\r\n        <ion-row class=\"ion-justify-content-center ion-margin\">\r\n          <ion-col size-lg=\"1\" size-xs=\"2\" class=\"flex-col\">\r\n            <ion-fab>\r\n              <ion-fab-button color=\"light\" (click)=\"resetTimer()\">\r\n                <ion-icon name=\"repeat-outline\" size=\"large\"></ion-icon>\r\n              </ion-fab-button>\r\n            </ion-fab>\r\n          </ion-col>\r\n          <ion-col size-lg=\"1\" size-xs=\"2\" class=\"flex-col\">\r\n            <ion-fab>\r\n              <ion-fab-button color=\"light\" (click)=\"toggleTimer()\">\r\n                <ion-icon *ngIf=\"!timerActive\" name=\"play-outline\"></ion-icon>\r\n                <ion-icon *ngIf=\"timerActive\" name=\"pause-outline\"></ion-icon>\r\n              </ion-fab-button>\r\n            </ion-fab>\r\n          </ion-col>\r\n          <ion-col size-lg=\"1\" size-xs=\"2\" class=\"flex-col\">\r\n            <ion-fab>\r\n              <ion-fab-button color=\"light\" id=\"music-settings-modal\">\r\n                <ion-icon name=\"musical-notes-outline\"></ion-icon>\r\n              </ion-fab-button>\r\n              <!-- <ion-fab-list side=\"end\">\r\n                <ion-fab-button>\r\n                  <fa-icon [icon]=\"['fas', 'volume-xmark']\"></fa-icon>\r\n                </ion-fab-button>\r\n                <ion-fab-button>\r\n                  <fa-icon [icon]=\"['fab', 'spotify']\"></fa-icon>\r\n                </ion-fab-button>\r\n                <ion-fab-button id=\"youtube-settings-modal\">\r\n                  <fa-icon [icon]=\"['fab', 'youtube']\"></fa-icon>\r\n                </ion-fab-button>\r\n              </ion-fab-list> -->\r\n            </ion-fab>\r\n          </ion-col>\r\n        </ion-row>\r\n      </ion-grid>\r\n    </div>\r\n  </div>\r\n</ion-content>\r\n<ion-footer>\r\n  <ion-fab vertical=\"bottom\" horizontal=\"end\">\r\n    <ion-fab-button size=\"small\" color=\"light\">\r\n      <ion-icon name=\"settings\"></ion-icon>\r\n    </ion-fab-button>\r\n    <ion-fab-list side=\"top\">\r\n      <ion-fab-button id=\"timer-settings-modal\">\r\n        <ion-icon name=\"alarm\"></ion-icon>\r\n      </ion-fab-button>\r\n      <ion-fab-button id=\"profile-modal\">\r\n        <fa-icon [icon]=\"['far', 'user']\"></fa-icon>\r\n      </ion-fab-button>\r\n      <ion-fab-button [routerLink]=\"'/about'\">\r\n        <ion-icon name=\"information-outline\"></ion-icon>\r\n      </ion-fab-button>\r\n    </ion-fab-list>\r\n  </ion-fab>\r\n</ion-footer>\r\n<youtube-player id=\"youtube-audio\" [videoId]=\"iFrameId\" loop=\"1\" [playlist]=\"iFrameId\" (ready)=\"onReady($event)\">\r\n</youtube-player>\r\n<ion-modal trigger=\"timer-settings-modal\" #timerModal>\r\n  <ng-template>\r\n    <ion-header>\r\n      <ion-toolbar>\r\n        <ion-toolbar>\r\n          <ion-buttons slot=\"end\">\r\n            <ion-button color=\"dark\" (click)=\"closeSettingModal()\">\r\n              <ion-icon name=\"checkmark-outline\"></ion-icon>\r\n            </ion-button>\r\n          </ion-buttons>\r\n          <ion-title>Timer Settings</ion-title>\r\n        </ion-toolbar>\r\n      </ion-toolbar>\r\n    </ion-header>\r\n    <ion-content class=\"ion-padding\">\r\n      <ion-list>\r\n        <ion-item class=\"ion-margin-horizontal\">\r\n          <ion-label position=\"floating\">Pomodoro Time</ion-label>\r\n          <ion-input [(ngModel)]=\"sessionTime\" type=\"number\"></ion-input>\r\n        </ion-item>\r\n        <ion-item class=\"ion-margin-horizontal\">\r\n          <ion-label position=\"floating\">Short Break Time</ion-label>\r\n          <ion-input [(ngModel)]=\"shortBreakTime\" type=\"number\"></ion-input>\r\n        </ion-item>\r\n        <ion-item class=\"ion-margin-horizontal\">\r\n          <ion-label position=\"floating\">Long Break Frequency</ion-label>\r\n          <ion-input [(ngModel)]=\"longBreakInterval\" type=\"number\"></ion-input>\r\n        </ion-item>\r\n        <ion-item class=\"ion-margin-horizontal\">\r\n          <ion-label position=\"floating\">Long Break Time</ion-label>\r\n          <ion-input [(ngModel)]=\"longBreakTime\" type=\"number\"></ion-input>\r\n        </ion-item>\r\n      </ion-list>\r\n    </ion-content>\r\n  </ng-template>\r\n</ion-modal>\r\n<ion-modal trigger=\"profile-modal\" #profileModal>\r\n  <ng-template>\r\n    <ng-container *ngIf=\"!loggedIn\">\r\n      <ion-header>\r\n        <ion-toolbar>\r\n          <ion-toolbar>\r\n            <ion-buttons slot=\"start\">\r\n              <ion-button (click)=\"profileModal.dismiss(null, 'cancel')\">\r\n                <ion-icon slot=\"icon-only\" name=\"arrow-back-outline\"></ion-icon>\r\n              </ion-button>\r\n            </ion-buttons>\r\n            <ion-segment [(ngModel)]=\"signInMode\" (ionChange)=\"signInSegmentChanged($event)\">\r\n              <ion-segment-button value=\"signIn\">\r\n                <ion-label>Sign In</ion-label>\r\n              </ion-segment-button>\r\n              <ion-segment-button value=\"signUp\">\r\n                <ion-label>Sign Up</ion-label>\r\n              </ion-segment-button>\r\n            </ion-segment>\r\n          </ion-toolbar>\r\n        </ion-toolbar>\r\n      </ion-header>\r\n    </ng-container>\r\n    <ng-container *ngIf=\"loggedIn\">\r\n      <ion-header>\r\n        <ion-toolbar>\r\n          <ion-toolbar>\r\n            <ion-buttons slot=\"start\">\r\n              <ion-button (click)=\"profileModal.dismiss(null, 'cancel')\">\r\n                <ion-icon slot=\"icon-only\" name=\"arrow-back-outline\"></ion-icon>\r\n              </ion-button>\r\n            </ion-buttons>\r\n            <ion-title>\r\n              Hi, {{user}}\r\n            </ion-title>\r\n          </ion-toolbar>\r\n        </ion-toolbar>\r\n      </ion-header>\r\n    </ng-container>\r\n    <ion-content *ngIf=\"!authLoading && !loggedIn\" class=\"ion-padding\" [ngSwitch]=\"signInMode\">\r\n      <ion-list *ngSwitchCase=\"'signIn'\" [formGroup]=\"loginForm\">\r\n        <ng-container *ngIf=\"!resetPassword\">\r\n          <ion-item class=\"ion-margin-horizontal\">\r\n            <ion-label position=\"floating\">email</ion-label>\r\n            <ion-input formControlName=\"email\" type=\"email\" placeholder=\"your@email.com\"></ion-input>\r\n          </ion-item>\r\n          <ion-item class=\"ion-margin-horizontal\">\r\n            <ion-label position=\"floating\">Password</ion-label>\r\n            <ion-input formControlName=\"password\" type=\"password\"></ion-input>\r\n          </ion-item>\r\n          <div>\r\n            <ion-button expand=\"full\" (click)=\"signIn()\" class=\"ion-margin\">\r\n              Sign In\r\n            </ion-button>\r\n          </div>\r\n          <div class=\"ion-margin ion-text-center\">\r\n            <a class=\"\" (click)=\"resetPassword = !resetPassword;\">Forgot your password?</a>\r\n          </div>\r\n        </ng-container>\r\n        <ng-container *ngIf=\"resetPassword\">\r\n          <ion-item class=\"ion-margin-horizontal\">\r\n            <ion-label position=\"floating\">email</ion-label>\r\n            <ion-input formControlName=\"email\" type=\"email\" placeholder=\"your@email.com\"></ion-input>\r\n          </ion-item>\r\n          <div>\r\n            <ion-button expand=\"full\" (click)=\"sendResetPasswordEmail()\" class=\"ion-margin\">\r\n              Reset Password</ion-button>\r\n          </div>\r\n          <ion-button fill=\"clear w-100 mt-3\" (click)=\"resetPassword = !resetPassword;\">\r\n            <ion-icon name=\"chevron-back-outline\">\r\n            </ion-icon> Back to sign in\r\n          </ion-button>\r\n        </ng-container>\r\n      </ion-list>\r\n      <ion-list *ngSwitchCase=\"'signUp'\" [formGroup]=\"signupForm\">\r\n        <ion-item class=\"ion-margin-horizontal\">\r\n          <ion-label position=\"floating\">email</ion-label>\r\n          <ion-input formControlName=\"email\" type=\"email\" placeholder=\"your@email.com\"></ion-input>\r\n        </ion-item>\r\n        <ion-item class=\"ion-margin-horizontal\">\r\n          <ion-label position=\"floating\">Password</ion-label>\r\n          <ion-input formControlName=\"password\" type=\"password\"></ion-input>\r\n        </ion-item>\r\n        <div class=\"ion-text-end\">\r\n          <ion-button expand=\"full\" (click)=\"signUp()\" class=\"ion-margin\">\r\n            Sign Up\r\n          </ion-button>\r\n        </div>\r\n      </ion-list>\r\n    </ion-content>\r\n    <ion-content *ngIf=\"authLoading\" class=\"ion-text-center\">\r\n      <ion-spinner name=\"crescent\" class=\"ion-margin\"></ion-spinner>\r\n    </ion-content>\r\n    <ion-content *ngIf=\"!authLoading && loggedIn\">\r\n      <ion-content>\r\n        <ion-button expand=\"full\" (click)=\"logout()\" class=\"ion-margin\">\r\n          Log Out\r\n        </ion-button>\r\n      </ion-content>\r\n    </ion-content>\r\n  </ng-template>\r\n</ion-modal>\r\n<ion-modal trigger=\"music-settings-modal\" #youTubeModal>\r\n  <ng-template>\r\n    <ion-header>\r\n      <ion-toolbar>\r\n        <ion-toolbar>\r\n          <ion-buttons slot=\"end\">\r\n            <ion-button (click)=\"youTubeModal.dismiss(null, 'cancel')\">\r\n              <ion-icon slot=\"icon-only\" name=\"checkmark-outline\"></ion-icon>\r\n            </ion-button>\r\n          </ion-buttons>\r\n          <ion-segment [(ngModel)]=\"musicMode\" (ionChange)=\"musicSegmentChanged($event)\">\r\n            <ion-segment-button value=\"youtube\">\r\n              <fa-icon [icon]=\"['fab', 'youtube']\"></fa-icon>\r\n            </ion-segment-button>\r\n            <ion-segment-button value=\"spotify\">\r\n              <fa-icon [icon]=\"['fab', 'spotify']\"></fa-icon>\r\n            </ion-segment-button>\r\n          </ion-segment>\r\n        </ion-toolbar>\r\n      </ion-toolbar>\r\n    </ion-header>\r\n    <ion-content class=\"ion-padding\" [ngSwitch]=\"musicMode\">\r\n      <ng-container *ngSwitchCase=\"'youtube'\">\r\n        <ion-card>\r\n          <ion-grid>\r\n            <ion-row>\r\n              <ion-col size=\"10\">\r\n                <ion-list [formGroup]=\"youtubeForm\">\r\n                  <ion-title>\r\n                    Add Youtube Video\r\n                  </ion-title>\r\n                  <ion-item class=\"ion-margin-horizontal\">\r\n                    <ion-label position=\"floating\">Youtube video URL</ion-label>\r\n                    <ion-input formControlName=\"id\"></ion-input>\r\n                  </ion-item>\r\n                  <ion-item class=\"ion-margin-horizontal\">\r\n                    <ion-label position=\"floating\">Video Name</ion-label>\r\n                    <ion-input formControlName=\"name\"></ion-input>\r\n                  </ion-item>\r\n                </ion-list>\r\n              </ion-col>\r\n              <ion-col size=\"2\" class=\"flex-col\">\r\n                <ion-button (click)=\"saveYoutubeVideo()\">\r\n                  <ion-icon name=\"add-outline\"></ion-icon>\r\n                </ion-button>\r\n              </ion-col>\r\n            </ion-row>\r\n          </ion-grid>\r\n        </ion-card>\r\n        <ion-card>\r\n          <ion-row>\r\n            <ion-col size=\"12\">\r\n              <ion-list>\r\n                <ion-title>\r\n                  Youtube Videos\r\n                </ion-title>\r\n                <ion-radio-group value=\"\" (ionChange)=\"setVideo($event)\">\r\n                  <ion-item *ngFor=\"let video of youtubeVids\">\r\n                    <ion-label>{{ video.name }}</ion-label>\r\n                    <ion-radio slot=\"start\" [value]=\"video.id\"></ion-radio>\r\n                  </ion-item>\r\n                </ion-radio-group>\r\n              </ion-list>\r\n            </ion-col>\r\n          </ion-row>\r\n        </ion-card>\r\n      </ng-container>\r\n      <ng-container *ngSwitchCase=\"'spotify'\">\r\n        <ion-title>\r\n          Spotify Integration Coming Soon!\r\n        </ion-title>\r\n      </ng-container>\r\n    </ion-content>\r\n  </ng-template>\r\n</ion-modal>\r\n";

/***/ })

}]);
//# sourceMappingURL=src_app_home_home_module_ts.js.map
